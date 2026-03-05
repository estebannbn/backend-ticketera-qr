import { Request, Response } from "express";
import { prisma } from "../prisma.js";
import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

const crearEvento = async (req: Request, res: Response) => {
  try {
    const {
      nombre,
      fechaHoraEvento,
      ubicacion,
      capacidadMax,
      descripcion,
      idCategoria,
      idOrganizacion,
      foto
    } = req.body;

    const evento = await prisma.evento.create({
      data: {
        nombre,
        fechaHoraEvento: new Date(fechaHoraEvento),
        ubicacion,
        capacidadMax,
        descripcion,
        idCategoria,
        idOrganizacion,
        foto
      }
    });

    res.status(201).json(evento);
  } catch (error) {
    res.status(500).json({ error: "Error al crear evento" });
  }
};

const obtenerEventos = async (req: Request, res: Response) => {
  try {
    const idOrganizacion = req.query.idOrganizacion
      ? Number(req.query.idOrganizacion)
      : undefined;

    const eventos = await prisma.evento.findMany({
      where: idOrganizacion ? { idOrganizacion } : {},
      include: {
        categoria: true,
        organizacion: true,
        tipoTickets: true
      }
    });

    res.json(eventos);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener eventos" });
  }
};

const obtenerEventosPorId = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    const evento = await prisma.evento.findUnique({
      where: { idEvento: id },
      include: {
        categoria: true,
        organizacion: true,
        tipoTickets: true
      }
    });

    if (!evento) {
      return res.status(404).json({ error: "Evento no encontrado" });
    }

    res.json(evento);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener evento" });
  }
};

const eliminarEvento = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    await prisma.evento.delete({
      where: { idEvento: id }
    });

    res.json({ message: "Evento eliminado" });
  } catch (error) {
    res.status(500).json({ error: "Error al eliminar evento" });
  }
};

const cambiarFechaEvento = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { fechaHoraEvento } = req.body;

    const evento = await prisma.evento.update({
      where: { idEvento: id },
      data: {
        fechaHoraEvento: new Date(fechaHoraEvento)
      }
    });

    res.json(evento);
  } catch (error) {
    res.status(500).json({ error: "Error al cambiar fecha del evento" });
  }
};

const cancelarEvento = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    const evento = await prisma.evento.update({
      where: { idEvento: id },
      data: { estado: "CANCELADO" }
    });

    const tickets = await prisma.ticket.findMany({
      where: {
        tipoTicket: {
          idEvento: id
        }
      },
      include: {
        cliente: {
          include: {
            usuario: true
          }
        }
      }
    });

    const mails = Array.from(
      new Set(tickets.map(t => t.cliente.usuario.mail))
    );

    for (const mail of mails) {
      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: mail,
        subject: "Cancelación de evento",
        text: `El evento "${evento.nombre}" ha sido cancelado.`
      });
    }

    res.json({
      message: "Evento cancelado y clientes notificados"
    });
  } catch (error) {
    res.status(500).json({ error: "Error al cancelar evento" });
  }
};

const getEstadisticas = async (_req: Request, res: Response) => {
  try {
    const totalEventos = await prisma.evento.count();

    const eventosActivos = await prisma.evento.count({
      where: { estado: "ACTIVO" }
    });

    const eventosCancelados = await prisma.evento.count({
      where: { estado: "CANCELADO" }
    });

    res.json({
      totalEventos,
      eventosActivos,
      eventosCancelados
    });
  } catch (error) {
    res.status(500).json({ error: "Error al obtener estadísticas" });
  }
};

const getVentasPorHora = async (_req: Request, res: Response) => {
  try {
    const ventas = await prisma.$queryRaw<
      { hora: Date; ventas: bigint }[]
    >`
      SELECT date_trunc('hour', "fechaCreacion") as hora, count(*) as ventas
      FROM "Ticket"
      GROUP BY hora
      ORDER BY hora
    `;

    res.json(ventas);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener ventas por hora" });
  }
};

const getEventosPorCategoria = async (_req: Request, res: Response) => {
  try {
    const data = await prisma.$queryRaw<
      { nombreCategoria: string; cantidad: bigint }[]
    >`
      SELECT c."nombreCategoria", count(e."idEvento") as cantidad
      FROM "Categoria" c
      LEFT JOIN "Evento" e ON e."idCategoria" = c."idCategoria"
      GROUP BY c."nombreCategoria"
      ORDER BY cantidad DESC
    `;

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener eventos por categoría" });
  }
};

export default {
  crearEvento,
  obtenerEventos,
  obtenerEventosPorId,
  eliminarEvento,
  cambiarFechaEvento,
  cancelarEvento,
  getEstadisticas,
  getVentasPorHora,
  getEventosPorCategoria
};