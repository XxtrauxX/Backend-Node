const conexion = require("../helpers/conexion");
const PaymentModel = require("../models/paymentModel");
const DonationModel = require("../models/donationModel");

const WompiService = require("../services/wompiService");
const PaymentService = require("../services/paymentService");

const SubscriptionModel = require("../models/subscriptionModel");

const { default: axios } = require("axios");
const TokenManager = require("../helpers/tokenizer.js");

const requiredEnvVars = [
  "WOMPI_INTEGRITY_KEY",
  "WOMPI_PUBLIC_KEY",
  "WOMPI_URL",
];

class WompiController {
  constructor() {
    WompiController.validateEnvironmentVars();
  }

  validateEnvironmentVars() {
    requiredEnvVars.forEach((varName) => {
      if (!process.env[varName]) {
        throw new Error(`Missing required environment variable: ${varName}`);
      }
    });
  }

  static generateSignature(req, res) {
    const { reference, amountInCents, currency } = req.body;
    return res.status(200).json({
      signature: WompiService.generateSignature(
        reference,
        amountInCents,
        currency
      ),
    });
  }

  static async saveDonation(req, res) {
    let connection;
    try {
      connection = (await conexion.getConexion()).connection;
      const paymentData = req.body;

      if (
        !paymentData ||
        !paymentData.reference ||
        !paymentData.amountInCents ||
        !paymentData.currency ||
        !paymentData.signature
      ) {
        return res
          .status(400)
          .json({ error: "Datos incompletos en la solicitud." });
      }

      const expectedSignature = WompiService.generateSignature(
        paymentData.reference,
        paymentData.amountInCents,
        paymentData.currency
      );

      // Comparar la firma generada con la firma enviada en la solicitud
      if (paymentData.signature !== expectedSignature) {
        if (connection) await connection.rollback();
        return res.status(400).json({ error: "Firma inválida." });
      }

      await connection.beginTransaction();

      const paymentMethodType = paymentData.paymentMethodType
        ? paymentData.paymentMethodType.toLowerCase()
        : "unknown";

      const payment = await PaymentModel.create({
          reference: paymentData.reference,
          sponsor_id: null,
          user_id: Number(paymentData.customerData?.id) || null,
          amount: paymentData.amountInCents / 100,
          payment_date: paymentData.payment_date,
          currency: paymentData.currency,
          transaction_id: paymentData.transaction_id,
          payment_status: paymentData.status.toUpperCase() || "PENDING",
          payment_method: paymentMethodType,
      });

      const donation = await DonationModel.create({
          payment_id: paymentData.reference,
          message: `Donation via ${paymentMethodType}`,
          amount: paymentData.amountInCents / 100,
          camper_id: null,
          sponsor_id: Number(paymentData.customerData?.id) || null,
      });

      await connection.commit();

      return res.status(200).json({
        message: "Datos guardados correctamente.",
        payment,
        donation,
      });
    } catch (error) {
      if (connection) {
        await connection.rollback();
      }
      console.error("Error en savePaymentInfo:", error);
      return res.status(500).json({ error: "Error interno del servidor." });
    } finally {
      if (connection) {
        connection.release();
      }
    }
  }

  static async receiveWebhook(req, res) {
    try {
      const event = req.body;

      const processedWebhook = await WompiService.checkWebHook(event);

      if (
        processedWebhook.code &&
        processedWebhook.error &&
        (processedWebhook.code !== 200 ||
          processedWebhook.error === "Evento duplicado.")
      ) {
        return res.status(processedWebhook.code).json({
          message: processedWebhook.error,
        });
      }

      if (processedWebhook.status === "APPROVED") {
        if (processedWebhook.reference.startsWith("ia_")) {
          console.log("Procesando Webhook tipo Cursos de IA.");
          await WompiService.processWebhookAI(processedWebhook);
        } else if (processedWebhook.reference.startsWith("sub_")) {
          console.log("Procesando Webhook tipo Subscripción.");
          await WompiService.processWebhookSubs(processedWebhook);
        } else if (processedWebhook.reference.startsWith("upg_")) {
          console.log("Procesando Webhook tipo Mejora de Plan.");
          await WompiService.processWebhookUpgrade(processedWebhook);
        }
      }

      if (processedWebhook.reference.startsWith("don_")) {
          console.log("Procesando Webhook tipo donación.");
          await WompiService.processWebhookDonation(processedWebhook);
      }

      return res
        .status(200)
        .json({ received: true, message: "Webhook recibido exitosamente" });
    } catch (error) {
      return res
        .status(500)
        .json({ error: "Ocurrió un error interno en el servidor." });
    }
  }

  static async generatePaySource(req, res) {
    try {
      const { type, ...fullData } = req.body;

      if (!type || type === null) {
        throw new Error("Tipo de medio de pago no definido");
      }
      const headers = {
        Authorization: `Bearer ${process.env.WOMPI_PRIVATE_KEY}`,
        "Content-Type": "application/json",
      };

      const { presigned_acceptance, presigned_personal_data_auth } =
        await WompiService.getAcceptanceTokens();

      console.log(
        `Creando medio de pago en Wompi para usuario ${req.user.id} con metodo de pago tipo ${type}...`
      );
      const payment_source_api_fulldata = await axios.post(
        `${process.env.WOMPI_URL}/payment_sources`,
        {
          type: type,
          token: fullData.token,
          payment_description: fullData.payment_description,
          customer_email: fullData.customer_email,
          acceptance_token: presigned_acceptance,
          accept_personal_auth: presigned_personal_data_auth,
        },
        {
          headers,
        }
      );
      console.log("Hecho.");

      let payment_source_api_data = payment_source_api_fulldata.data.data;

      payment_source_api_data = {
        ...payment_source_api_data,
        id: TokenManager.encryptToken(payment_source_api_data.id),
      };

      await PaymentService.createPayment({
        prefix: "sub",
        sponsor_id: req.user.id,
        user_id: null, // ? Temporalmente
        plan_id: fullData.plan_id,
        payment_method: type,
        currency: fullData.currency,
        customer_email: fullData.customer_email,
        payment_source_id: payment_source_api_data.id,
        frequency: fullData.frequency,
      });

      await SubscriptionModel.updatePaymentSourceByUser(req.user.id, {
        payment_source_id: payment_source_api_data.id,
      });

      res.status(200).json({ success: true, payment_source_api_data });
    } catch (error) {
      if (error.response) {
        console.error(
          "Error generando fuente de pago: ",
          error.response.data.error
        );
        return res
          .status(error.response.status)
          .json(error.response.data.error);
      }
      console.error("Error general generando fuente de pago: ", error);
      return res.status(500).json({
        error: "Ocurrió un error interno en el servidor.",
        res: error,
      });
    }
  }
}

// Exportar la clase directamente
module.exports = WompiController;
