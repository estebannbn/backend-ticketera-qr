import { z } from "zod";

export const crearCategoriaSchema = z.object({
    body: z.object({
        nombreCategoria: z.string()
            .min(3, "El nombre de la categoría debe tener al menos 3 caracteres")
            .regex(/^[^0-9]*$/, "El nombre de la categoría no puede contener números."),
    }),
});
