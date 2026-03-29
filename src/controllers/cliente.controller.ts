import { Rol, Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { Request, Response } from "express";
import { encrypt } from "../utils/handleCrypt.js";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

dayjs.extend(utc);
dayjs.extend(timezone);

const TIMEZONE = "America/Argentina/Buenos_Aires";

const crearCliente = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      mail,
      contraseña,
      nombre,
      apellido,
      tipoDoc,
      nroDoc,
      fechaNacimiento,
      telefono,
    } = req.body;

    const hashedPassword = await encrypt(contraseña);
    const nuevoCliente = await prisma.cliente.create({
      data: {
        nombre,
        apellido,
        tipoDoc,
        nroDoc,
        fechaNacimiento: dayjs.tz(fechaNacimiento, TIMEZONE).toDate(),
        telefono,
        usuario: {
          create: {
            mail,
            contraseña: hashedPassword,
            rol: Rol.CLIENTE,
          },
        },
      },
      include: {
        usuario: true,
      },
    });

    res.status(200).json({
      message: "Cliente creado con éxito",
      data: nuevoCliente,
      error: false,
    });
  } catch (error) {
    console.error("Error en crearCliente", error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        const target = error.meta?.target as string[];
        let message = "Ya existe un registro con estos datos únicos";

        if (target.includes("mail")) {
          message = "El correo electrónico ya está registrado";
        } else if (target.includes("nroDoc")) {
          message = "El número de documento ya está registrado";
        }

        res.status(400).json({
          message,
          error: true,
        });
        return;
      }
    }

    res.status(500).json({
      message: "Error al crear el cliente",
      error: true,
      details: (error as Error).message,
    });
  }
};

const obtenerClientes = async (req: Request, res: Response): Promise<void> => {
  try {
    const clientes = await prisma.cliente.findMany({
      include: {
        usuario: {
          select: {
            mail: true,
            rol: true,
          },
        },
      },
    });
    res.status(200).json({
      message: "Clientes obtenidos con éxito",
      data: clientes,
      error: false,
    });
  } catch (error) {
    console.error("Error en obtenerClientes:", error);
    res.status(500).json({
      message: "Error al obtener los clientes",
      error: true,
      details: (error as Error).message,
    });
  }
};

const obtenerClientePorId = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const cliente = await prisma.cliente.findUnique({
      where: { idCliente: parseInt(id) },
      include: {
        usuario: {
          select: {
            mail: true,
            rol: true,
          },
        },
      },
    });

    if (!cliente) {
      res.status(404).json({
        message: "Cliente no encontrado",
        error: true,
      });
      return;
    }

    res.status(200).json({
      message: "Cliente obtenido con éxito",
      data: cliente,
      error: false,
    });
  } catch (error) {
    console.error("Error en obtenerClientePorId:", error);
    res.status(500).json({
      message: "Error al obtener el cliente",
      error: true,
      details: (error as Error).message,
    });
  }
};

const eliminarCliente = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const clienteEliminado = await prisma.cliente.delete({
      where: { idCliente: parseInt(id) },
    });
    if (!clienteEliminado) {
      res.status(404).json({
        message: "Cliente no encontrado",
        error: true,
      });
      return;
    }
    res.status(200).json({
      message: "Cliente eliminado con éxito",
      error: false,
    });
  } catch (error) {
    res.status(500).json({
      message: "Error al eliminar el cliente",
      error: true,
      details: (error as Error).message,
    });
  }
};

const actualizarCliente = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const clienteData = req.body;

    const clienteExistente = await prisma.cliente.findUnique({
      where: { idCliente: parseInt(id) },
      include: { usuario: true },
    });

    if (!clienteExistente) {
      res.status(404).json({ message: "No se encontró ningún cliente con los criterios especificados.", error: true });
      return;
    }

    const updateData: Prisma.ClienteUpdateInput = {};
    if (clienteData.nombre !== undefined) updateData.nombre = clienteData.nombre;
    if (clienteData.apellido !== undefined) updateData.apellido = clienteData.apellido;
    if (clienteData.tipoDoc !== undefined) updateData.tipoDoc = clienteData.tipoDoc;
    if (clienteData.nroDoc !== undefined && clienteData.nroDoc !== clienteExistente.nroDoc) {
      updateData.nroDoc = clienteData.nroDoc;
    }
    if (clienteData.fechaNacimiento !== undefined) updateData.fechaNacimiento = dayjs.tz(clienteData.fechaNacimiento, TIMEZONE).toDate();
    if (clienteData.telefono !== undefined) updateData.telefono = clienteData.telefono;

    const usuarioUpdateData: Prisma.UsuarioUpdateInput = {};
    if (clienteData.mail !== undefined && clienteData.mail !== clienteExistente.usuario.mail) {
      usuarioUpdateData.mail = clienteData.mail;
    }
    if (clienteData.contraseña) {
      usuarioUpdateData.contraseña = await encrypt(clienteData.contraseña);
    }

    const [clienteActualizado] = await prisma.$transaction([
      prisma.cliente.update({
        where: { idCliente: parseInt(id) },
        data: updateData,
        include: { usuario: true },
      }),
      prisma.usuario.update({
        where: { idUsuario: clienteExistente.idUsuario },
        data: usuarioUpdateData,
      }),
    ]);

    res.status(200).json({
      message: "Cliente actualizado con éxito",
      data: clienteActualizado,
      error: false,
    });
  } catch (error) {
    console.error("Error en actualizarCliente:", error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        const target = error.meta?.target as string[];
        let message = "Ya existe un registro con estos datos únicos";

        if (target.includes("mail")) {
          message = "El correo electrónico ya está en uso por otro usuario";
        } else if (target.includes("nroDoc")) {
          message = "El número de documento ya está en uso por otro cliente";
        }

        res.status(400).json({
          message,
          error: true,
        });
        return;
      }
    }

    res.status(500).json({
      message: "Error al actualizar el cliente",
      error: true,
      details: (error as Error).message,
    });
  }
};

const obtenerClientePorIdUsuario = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { idUsuario } = req.params;
    const cliente = await prisma.cliente.findUnique({
      where: { idUsuario: parseInt(idUsuario) },
      include: {
        usuario: {
          select: {
            mail: true,
            rol: true,
          },
        },
      },
    });

    if (!cliente) {
      res.status(404).json({
        message: "No existe un perfil de cliente asociado a esta cuenta de usuario.",
        error: true,
      });
      return;
    }

    res.status(200).json({
      message: "Cliente obtenido con éxito",
      data: cliente,
      error: false,
    });
  } catch (error) {
    console.error("Error en obtenerClientePorIdUsuario:", error);
    res.status(500).json({
      message: "Error al obtener el cliente",
      error: true,
      details: (error as Error).message,
    });
  }
};

export default {
  crearCliente,
  obtenerClientes,
  obtenerClientePorId,
  eliminarCliente,
  actualizarCliente,
  obtenerClientePorIdUsuario,
};
