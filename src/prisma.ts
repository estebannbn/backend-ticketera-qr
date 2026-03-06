import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

// Cargar variables de entorno
dotenv.config();

export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL_DEV,
    },
  },
});
