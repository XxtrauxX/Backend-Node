const landingAIModel = require('../models/landingAIModel');
const { sendWelcomeEmail, sendNotificationEmail } = require('./emailSendindController');

// Función para manejar respuestas estándar
const handleResponse = (res, status, message, data = null, error = null) => {
    return res.status(status).json({
        success: status === 200,
        message,
        data,
        error,
    });
};

// Función para validar parámetros
const validateParams = (params, requiredFields) => {
    for (const field of requiredFields) {
        if (!params[field]) {
            return `Falta el campo ${field}`;
        }
    }
    return null;
};

const landingAIController = {
    saveRegisteredInfo: async (req, res) => {
        try {
            const { name, lastname, email, phone, document, payment_reference, selected_course, numSeats } = req.body;
            const payment_date = null; // La fecha se crea en null, luego se actualiza

            // Validación de campos requeridos
            const missingField = validateParams(req.body, ['name', 'lastname', 'email', 'phone', 'document', 'payment_reference', 'selected_course']);
            if (missingField) {
                return handleResponse(res, 400, missingField);
            }

            await landingAIModel.saveRegisteredInfo({
                name, lastname, email, phone, document, payment_reference, payment_date, selected_course, numSeats
            });

            return handleResponse(res, 200, "Registro guardado exitosamente");
        } catch (error) {
            console.error("Error guardando la información:", error);
            return handleResponse(res, 500, "Error interno del servidor", null, error.message);
        }
    },

    getAllRegistered: async (req, res) => {
        try {
            const registros = await landingAIModel.getAllRegistered();
            return handleResponse(res, 200, "Registros obtenidos exitosamente", registros);
        } catch (error) {
            console.error("Error obteniendo los registros:", error);
            return handleResponse(res, 500, "Error interno del servidor", null, error.message);
        }
    },

    getAllRegisteredByCourseDate: async (req, res) => {
        try {
            const { courseDate } = req.query;

            // Validación de parámetro 'courseDate'
            if (!courseDate) {
                return handleResponse(res, 400, "Falta la fecha del curso");
            }

            const registros = await landingAIModel.getAllRegisteredByCourseDate(courseDate);
            return handleResponse(res, 200, "Registros obtenidos exitosamente para la fecha del curso", registros);
        } catch (error) {
            console.error("Error obteniendo los registros por fecha de curso:", error);
            return handleResponse(res, 500, "Error interno del servidor", null, error.message);
        }
    },

    getRegisteredById: async (req, res) => {
        try {
            const { id } = req.params;

            // Validación de parámetro 'id'
            if (!id) {
                return handleResponse(res, 400, "ID no proporcionado");
            }

            const registro = await landingAIModel.getRegisteredById(id);
            if (!registro) {
                return handleResponse(res, 404, "Registro no encontrado");
            }

            return handleResponse(res, 200, "Registro obtenido exitosamente", registro);
        } catch (error) {
            console.error("Error obteniendo el registro:", error);
            return handleResponse(res, 500, "Error interno del servidor", null, error.message);
        }
    },

    getConfirmedCount: async (req, res) => {
        try {
            const total = await landingAIModel.getConfirmedCount();
            return handleResponse(res, 200, "Total de Registros Exitosos obtenidos exitosamente", total);
        } catch (error) {
            console.error("Error obteniendo los registros:", error);
            return handleResponse(res, 500, "Error interno del servidor", null, error.message);
        }
    },

    getConfirmedCountByCourseDate: async (req, res) => {
        try {
            const { courseDate } = req.query;

            // Validación de parámetro 'courseDate'
            if (!courseDate) {
                return handleResponse(res, 400, "Falta la fecha del curso");
            }

            const totalConfirmed = await landingAIModel.getConfirmedCountByCourseDate(courseDate);
            return handleResponse(res, 200, "Total de registros exitosos obtenidos para la fecha del curso", totalConfirmed);
        } catch (error) {
            console.error("Error obteniendo el conteo de registros confirmados por fecha de curso:", error);
            return handleResponse(res, 500, "Error interno del servidor", null, error.message);
        }
    },

    enviarCorreo: async (req, res) => {
        try {
            // Obtener los datos necesarios del cuerpo de la solicitud
            const { name, lastname, email, phone, document, selected_course, paymentMethod, amount, contactEmail } = req.body;

            // Validación de campos requeridos
            const missingField = validateParams(req.body, ['name', 'lastname', 'email', 'phone', 'document', 'selected_course']);
            if (missingField) {
                return handleResponse(res, 400, missingField);
            }

            // Enviar correo de bienvenida al usuario
            const welcomeEmailResponse = await sendWelcomeEmail(email, `${name} ${lastname}`, selected_course);
            if (!welcomeEmailResponse.success) {
                return handleResponse(res, 500, 'Error al enviar el correo de bienvenida', null, welcomeEmailResponse.error);
            }

            // Enviar notificación al contacto (admin o encargado)
            const notificationEmailResponse = await sendNotificationEmail({
                email,
                username: `${name} ${lastname}`,
                phone,
                documentNumber: document,
                documentType: '',  // Puedes agregar el tipo de documento si es necesario
                paymentMethod,
                amount,
                contactEmail,
                selected_course
            });
            if (!notificationEmailResponse.success) {
                return handleResponse(res, 500, 'Error al enviar el correo de notificación', null, notificationEmailResponse.error);
            }

            // Si todo sale bien, responder con éxito
            return handleResponse(res, 200, "Correo de confirmación y notificación enviados correctamente");

        } catch (error) {
            console.error("Error en enviarCorreo:", error);
            return handleResponse(res, 500, "Error interno del servidor", null, error.message);
        }
    }
};

module.exports = landingAIController;
