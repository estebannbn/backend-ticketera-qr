import { z } from "zod";

export const crearPoliticaSchema = z.object({
    body: z.object({
        diasReembolso: z.number().int().min(0, "Los días de reembolso deben ser 0 o más").optional(),
    }),
});
