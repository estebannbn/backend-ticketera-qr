import { z } from "zod";

export const crearTicketSchema = z.object({
    body: z.object({
        idCliente: z.number().int().positive("ID de cliente inválido"),
        idTipoTicket: z.number().int().positive("ID de tipo de ticket inválido"),
    }),
});

export const procesarPagoSchema = z.object({
    body: z.object({
        nroTicket: z.number().int().positive("Número de ticket inválido"),
        formData: z.any(),
    }),
});


export const consumirTicketSchema = z.object({
    params: z.object({
        tokenQr: z.string().min(1, "Token QR es requerido"),
    }),
});

export const transferirTicketSchema = z.object({
    body: z.object({
        nroTicket: z.number().int().positive("Número de ticket inválido"),
        mailNuevoDueño: z.string().email("Email del nuevo dueño inválido"),
    }),
});

export const reembolsarTicketSchema = z.object({
    body: z.object({
        nroTicket: z.number().int().positive("Número de ticket inválido"),
    }),
});
export const actualizarTicketSchema = z.object({
    params: z.object({
        id: z.string().regex(/^\d+$/, "ID de ticket inválido"),
    }),
    body: z.object({
        idCliente: z.number().int().positive().optional(),
        idTipoTicket: z.number().int().positive().optional(),
        estado: z.string().optional(),
    }).partial(),
});

export const aceptarTransferenciaSchema = z.object({
    body: z.object({
        nroTicket: z.number().int().positive("Número de ticket inválido"),
    }),
});

export const rechazarTransferenciaSchema = z.object({
    body: z.object({
        nroTicket: z.number().int().positive("Número de ticket inválido"),
    }),
});
