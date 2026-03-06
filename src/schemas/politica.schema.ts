import { z } from "zod";

export const crearPoliticaSchema = z.object({
    body: z.object({
        diasReembolso: z.number().int().min(0, "Los días de reembolso deben ser 0 o más").optional(),
        fechaVigencia: z.string().or(z.date()).optional(),
    }),
});

export const actualizarPoliticaSchema = z.object({
    params: z.object({
        id: z.string().regex(/^\d+$/, "ID de política inválido"),
    }),
    body: z.object({
        diasReembolso: z.number().int().min(0).optional(),
        fechaVigencia: z.string().or(z.date()).optional(),
    }).partial(),
});
