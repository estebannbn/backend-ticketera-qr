import { prisma } from "../prisma.js";
import { Request, Response } from "express";

export const crearCategoria = async (req: Request, res: Response): Promise<void> => {
  try {
    const categoriaExistente = await prisma.categoria.findFirst({
      where: {
        nombreCategoria: {
          equals: req.body.nombreCategoria,
          mode: 'insensitive'
        }
      }
    });

    if (categoriaExistente) {
      if (!categoriaExistente.activo) {
        // Reactivar si estaba inactiva
        const categoriaReactivada = await prisma.categoria.update({
          where: { idCategoria: categoriaExistente.idCategoria },
          data: { activo: true }
        });
        res.status(200).json({
          message: "Categoría reactivada con éxito",
          data: categoriaReactivada,
          error: false,
        });
        return;
      }
      res.status(400).json({
        message: "Ya existe una categoría activa con ese nombre",
        error: true,
        details: [
          {
            path: "body.nombreCategoria",
            message: "Ya existe una categoría activa con ese nombre"
          }
        ]
      });
      return;
    }

    const categoria = await prisma.categoria.create({
      data: {
        nombreCategoria: req.body.nombreCategoria,
      },
    });

    res.status(200).json({
      message: "Categoría creada con éxito",
      data: categoria,
      error: false,
    });
  } catch (error) {
    console.error("Error en crearCategoria", error);
    res.status(500).json({
      message: "Error al crear la categoria",
      error: true,
      details: (error as Error).message,
    });
  }
};

export const obtenerCategorias = async (req: Request, res: Response): Promise<void> => {
  try {
    const { nombre } = req.query;

    const whereClause: any = { activo: true }; // Por defecto solo las activas
    if (nombre) {
      whereClause.nombreCategoria = {
        contains: String(nombre),
        mode: 'insensitive'
      };
    }

    const categorias = await prisma.categoria.findMany({
      where: whereClause
    });

    res.status(200).json({
      message: "Categorias obtenidas con éxito",
      data: categorias,
      error: false,
    });
  } catch (error) {
    console.error("Error en obtenerCategorias:", error);
    res.status(500).json({
      message: "Error al obtener categorias",
      error: true,
      details: (error as Error).message,
    });
  }
};

export const obtenerCategoriaPorId = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const categoria = await prisma.categoria.findUnique({
      where: { idCategoria: parseInt(id) },
    });

    if (!categoria) {
      res.status(404).json({
        message: "La categoría solicitada no existe.",
        error: true,
      });
      return;
    }

    res.status(200).json({
      message: "Detalles de la categoría recuperados exitosamente",
      data: categoria,
      error: false,
    });
  } catch (error) {
    console.error("Error en obtenerCategoriaPorId", error);
    res.status(500).json({
      message: "Error al obtener la categoria",
      error: true,
      details: (error as Error).message,
    });
  }
};



export const eliminarCategoria = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;

    // Verificar si hay eventos ACTIVOS asociados a esta categoría
    const eventosActivos = await prisma.evento.count({
      where: { 
        idCategoria: parseInt(id),
        estado: 'ACTIVO'
      }
    });

    if (eventosActivos > 0) {
      res.status(400).json({
        message: "No se puede eliminar la categoría porque tiene eventos activos actualmente",
        error: true,
      });
      return;
    }

    // Baja lógica en lugar de borrado físico para temas estadísticos
    const categoriaInactivada = await prisma.categoria.update({
      where: { idCategoria: parseInt(id) },
      data: { activo: false }
    });

    if (!categoriaInactivada) {
      res.status(404).json({
        message: "La categoría solicitada no existe",
        error: true,
      });
      return;
    }

    res.status(200).json({
      message: "Categoria dada de baja con éxito (Baja lógica aplicada)",
      error: false,
    });
  } catch (error) {
    res.status(500).json({
      message: "Error al eliminar la categoria",
      error: true,
      details: (error as Error).message,
    });
  }
};

export default {
  crearCategoria,
  obtenerCategorias,
  obtenerCategoriaPorId,
  eliminarCategoria,
};
