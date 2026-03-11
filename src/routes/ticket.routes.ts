import express from "express";
import ticketController from "../controllers/ticket.controller.js";
import { checkSession } from "../middleware/session.js";
import { validate } from "../middleware/validate.middleware.js";
import {
    crearTicketSchema,
    procesarPagoSchema,
    consumirTicketSchema,
    transferirTicketSchema,
    reembolsarTicketSchema,
    actualizarTicketSchema,
    aceptarTransferenciaSchema,
    rechazarTransferenciaSchema,
} from "../schemas/ticket.schema.js";

import { idClienteParamSchema, idParamSchema } from "../schemas/common.schema.js";

const router = express.Router();

router.post("/", validate(crearTicketSchema), ticketController.crearTicket);
router.post("/webhook", ticketController.recibirWebhook);
router.get("/", ticketController.obtenerTickets);
router.get("/cliente/:idCliente", validate(idClienteParamSchema), ticketController.obtenerTicketsPorIdCliente);

router.post("/procesar-pago", validate(procesarPagoSchema), ticketController.procesarPago);
router.post("/sincronizar", ticketController.sincronizarPago);
router.get("/token/:tokenQr", checkSession, validate(consumirTicketSchema), ticketController.obtenerTicketPorToken);
router.put("/consumir/:tokenQr", checkSession, validate(consumirTicketSchema), ticketController.consumirTicket);
router.post("/transferir", validate(transferirTicketSchema), ticketController.transferirTicket);
router.post("/reembolsar", validate(reembolsarTicketSchema), ticketController.reembolsarTicket);
router.post("/aceptar-transferencia", validate(aceptarTransferenciaSchema), ticketController.aceptarTransferencia);
router.post("/rechazar-transferencia", validate(rechazarTransferenciaSchema), ticketController.rechazarTransferencia);

// Rutas con ID al final para evitar conflictos
router.get("/:id", validate(idParamSchema), ticketController.obtenerTicketPorId);
router.delete("/:id", validate(idParamSchema), ticketController.eliminarTicket);
router.patch("/:id", validate(actualizarTicketSchema), ticketController.actualizarTicket);

export default router;
