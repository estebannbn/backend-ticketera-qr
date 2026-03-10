import { Request, Response } from "express";
import { prisma } from "../prisma.js";
import { MercadoPagoConfig, PaymentRefund } from "mercadopago";
import { sendEventCancellationEmail, sendEventDateChangeEmail } from "../services/emailService.js";

// Configuración de Mercado Pago
if (!process.env.MP_ACCESS_TOKEN) {
  throw new Error("MP_ACCESS_TOKEN no está definido en el .env");
}

const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
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
      foto,
      tipoTickets
    } = req.body;

    const nuevaFecha = new Date(fechaHoraEvento);

    // Obtener la política actual
    const politica = await prisma.politica.findFirst({
      orderBy: {
        fechaVigencia: 'desc'
      }
    });

    const diasReembolso = politica?.diasReembolso || 0;

    // Calcular la fecha mínima permitida (hoy + diasReembolso)
    // Considerando la zona horaria UTC-3 (Argentina)
    const OFFSET_ARG = -3 * 60 * 60 * 1000; // -3 horas
    const ahoraArg = new Date(Date.now() + OFFSET_ARG);
    ahoraArg.setUTCHours(0, 0, 0, 0);

    // Convertir de nuevo a la medianoche real de Argentina referenciada en UTC absoluto
    const fechaMinima = new Date(ahoraArg.getTime() - OFFSET_ARG);
    fechaMinima.setUTCDate(fechaMinima.getUTCDate() + diasReembolso);

    if (nuevaFecha < fechaMinima) {
      return res.status(400).json({
        message: `La fecha del evento debe ser al menos ${diasReembolso} días posterior al día de hoy, según la política de reembolsos vigente.`,
        error: true
      });
    }

    const evento = await prisma.evento.create({
      data: {
        nombre,
        fechaHoraEvento: nuevaFecha,
        ubicacion,
        capacidadMax,
        descripcion,
        idCategoria,
        idOrganizacion,
        foto,
        tipoTickets: tipoTickets && tipoTickets.length > 0 ? {
          create: tipoTickets.map((tt: any) => ({
            tipo: tt.tipo,
            precio: Number(tt.precio),
            acceso: tt.acceso,
            sector: tt.sector,
            cantMaxPorTipo: Number(tt.cantMaxPorTipo)
          }))
        } : undefined
      },
      include: {
        tipoTickets: true
      }
    });

    res.status(201).json({
      message: "Evento creado con éxito",
      data: evento,
      error: false
    });
  } catch (error) {
    res.status(500).json({ message: "Error al crear evento", error: true });
  }
};

const obtenerEventos = async (req: Request, res: Response) => {
  try {
    const idOrganizacion = req.query.idOrganizacion
      ? Number(req.query.idOrganizacion)
      : undefined;

    const whereClause: any = idOrganizacion ? { idOrganizacion } : { estado: "ACTIVO" };

    const eventos = await prisma.evento.findMany({
      where: whereClause,
      include: {
        categoria: true,
        organizacion: true,
        tipoTickets: {
          include: {
            _count: {
              select: {
                tickets: {
                  where: {
                    estado: { notIn: ['reembolsado', 'expirado'] }
                  }
                }
              }
            }
          }
        }
      }
    });

    res.status(200).json({
      message: "Eventos obtenidos con éxito",
      data: eventos,
      error: false
    });
  } catch (error) {
    res.status(500).json({ message: "Error al obtener eventos", error: true });
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
        tipoTickets: {
          include: {
            _count: {
              select: {
                tickets: {
                  where: {
                    estado: { notIn: ['reembolsado', 'expirado'] }
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!evento) {
      return res.status(404).json({ message: "Evento no encontrado", error: true });
    }

    res.status(200).json({
      message: "Evento obtenido con éxito",
      data: evento,
      error: false
    });
  } catch (error) {
    res.status(500).json({ message: "Error al obtener evento", error: true });
  }
};

const eliminarEvento = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    await prisma.evento.delete({
      where: { idEvento: id }
    });

    res.status(200).json({
      message: "Evento eliminado con éxito",
      error: false
    });
  } catch (error) {
    res.status(500).json({ message: "Error al eliminar evento", error: true });
  }
};

const cambiarFechaEvento = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { fechaHoraEvento } = req.body;

    const nuevaFecha = new Date(fechaHoraEvento);

    // Obtener la política actual
    const politica = await prisma.politica.findFirst({
      orderBy: {
        fechaVigencia: 'desc'
      }
    });

    const diasReembolso = politica?.diasReembolso || 0;

    // Calcular la fecha mínima permitida (hoy + diasReembolso)
    // Considerando la zona horaria UTC-3 (Argentina)
    const OFFSET_ARG = -3 * 60 * 60 * 1000; // -3 horas
    const ahoraArg = new Date(Date.now() + OFFSET_ARG);
    ahoraArg.setUTCHours(0, 0, 0, 0);

    const fechaMinima = new Date(ahoraArg.getTime() - OFFSET_ARG);
    fechaMinima.setUTCDate(fechaMinima.getUTCDate() + diasReembolso);

    if (nuevaFecha < fechaMinima) {
      return res.status(400).json({
        message: `La fecha del evento debe ser al menos ${diasReembolso} días posterior al día de hoy, según la política de reembolsos vigente.`,
        error: true
      });
    }

    const evento = await prisma.evento.update({
      where: { idEvento: id },
      data: {
        fechaHoraEvento: nuevaFecha
      }
    });

    const tickets = await prisma.ticket.findMany({
      where: {
        tipoTicket: { idEvento: id },
        estado: { in: ["pagado", "pendiente_transferencia"] }
      },
      include: {
        cliente: { include: { usuario: true } }
      }
    });

    const mailsInfo = Array.from(
      new Map(tickets.map(t => [t.cliente.usuario.mail, `${t.cliente.nombre} ${t.cliente.apellido}`]))
    );

    const fechaFormateada = nuevaFecha.toLocaleString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      dateStyle: 'full',
      timeStyle: 'short'
    });

    const fechaAntiguaFormateada = evento.fechaHoraEvento.toLocaleString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      dateStyle: 'full',
      timeStyle: 'short'
    });

    for (const [mail, nombreUsuario] of mailsInfo) {
      await sendEventDateChangeEmail(mail, {
        evento: evento.nombre,
        fechaAntigua: fechaAntiguaFormateada,
        fechaNueva: fechaFormateada,
        usuario: String(nombreUsuario)
      });
    }

    res.status(200).json({
      message: "Fecha del evento cambiada y clientes notificados",
      data: evento,
      error: false
    });
  } catch (error) {
    res.status(500).json({ message: "Error al cambiar fecha del evento", error: true });
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

    const mailsInfo = Array.from(
      new Map(tickets.map(t => [t.cliente.usuario.mail, `${t.cliente.nombre} ${t.cliente.apellido}`]))
    );

    let reembolsadosCount = 0;
    let erroresCount = 0;

    for (const ticket of tickets) {
      if (ticket.estado === "pagado" && ticket.paymentId) {
        try {
          const refund = new PaymentRefund(client);
          await refund.create({ payment_id: Number(ticket.paymentId) });

          await prisma.ticket.update({
            where: { nroTicket: ticket.nroTicket },
            data: { estado: "reembolsado" }
          });
          reembolsadosCount++;
        } catch (err: any) {
          console.error(`Error al reembolsar ticket ${ticket.nroTicket}:`, err.message || err);
          erroresCount++;
        }
      } else if (["pendiente", "pendiente_transferencia"].includes(ticket.estado)) {
        await prisma.ticket.update({
          where: { nroTicket: ticket.nroTicket },
          data: { estado: "expirado" }
        });
      }
    }

    const fechaCanceladaFormateada = evento.fechaHoraEvento.toLocaleString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      dateStyle: 'full',
      timeStyle: 'short'
    });

    for (const [mail, nombreUsuario] of mailsInfo) {
      await sendEventCancellationEmail(mail, {
        evento: evento.nombre,
        fecha: fechaCanceladaFormateada,
        usuario: String(nombreUsuario)
      });
    }

    res.status(200).json({
      message: `Evento cancelado y clientes notificados. Reembolsos procesados: ${reembolsadosCount}. Errores: ${erroresCount}.`,
      error: false
    });
  } catch (error) {
    res.status(500).json({ message: "Error al cancelar evento", error: true });
  }
};

const getEstadisticas = async (req: Request, res: Response) => {
  try {
    const idOrganizacionStr = req.query.idOrganizacion as string;
    const idOrganizacion = idOrganizacionStr ? Number(idOrganizacionStr) : undefined;

    const whereClause = idOrganizacion ? { idOrganizacion } : {};

    const totalEventos = await prisma.evento.count({ where: whereClause });

    const eventosActivos = await prisma.evento.count({
      where: { ...whereClause, estado: "ACTIVO" }
    });

    const eventosCancelados = await prisma.evento.count({
      where: { ...whereClause, estado: "CANCELADO" }
    });

    const eventosFetch = await prisma.evento.findMany({
      where: whereClause,
      include: {
        tipoTickets: {
          include: {
            tickets: {
              include: {
                cliente: true
              }
            }
          }
        }
      }
    });

    const eventos = eventosFetch.map(evento => {
      let vendidos = 0;
      let reembolsados = 0;
      let recaudacion = 0;
      let sumaEdades = 0;
      let clientesContados = 0;

      evento.tipoTickets.forEach(tt => {
        const precio = Number(tt.precio);
        tt.tickets.forEach(ticket => {
          if (["pagado", "consumido", "pendiente_transferencia", "reembolsado"].includes(ticket.estado)) {
            vendidos++;
            if (ticket.estado === "reembolsado") {
              reembolsados++;
            } else {
              recaudacion += precio;
            }

            if (ticket.cliente && ticket.cliente.fechaNacimiento) {
              const ageDifMs = Date.now() - new Date(ticket.cliente.fechaNacimiento).getTime();
              const ageDate = new Date(ageDifMs);
              sumaEdades += Math.abs(ageDate.getUTCFullYear() - 1970);
              clientesContados++;
            }
          }
        });
      });

      return {
        idCategoria: evento.idCategoria,
        idEvento: evento.idEvento,
        nombre: evento.nombre,
        foto: evento.foto,
        fecha: evento.fechaHoraEvento,
        vendidos,
        reembolsados,
        porcReembolsados: vendidos > 0 ? (reembolsados / vendidos) * 100 : 0,
        recaudacion,
        edadPromedio: clientesContados > 0 ? Math.round(sumaEdades / clientesContados) : 0
      };
    });

    res.status(200).json({
      message: "Estadísticas obtenidas con éxito",
      data: {
        totalEventos,
        eventosActivos,
        eventosCancelados,
        eventos
      },
      error: false
    });
  } catch (error) {
    res.status(500).json({ message: "Error al obtener estadísticas", error: true });
  }
};

const getVentasPorHora = async (req: Request, res: Response) => {
  try {
    const idOrganizacionStr = req.query.idOrganizacion as string;
    const idOrganizacion = idOrganizacionStr ? Number(idOrganizacionStr) : undefined;

    // We construct the query mapping dynamically for simplicity since $queryRaw doesn't easily handle dynamic optional WHEREs without raw SQL wrappers
    let ventas;
    if (idOrganizacion) {
      ventas = await prisma.$queryRaw<{ hora: Date; ventas: bigint }[]>`
        SELECT date_trunc('hour', t."fechaCreacion") as hora, count(*) as ventas
        FROM "Ticket" t
        JOIN "TipoTicket" tt ON t."idTipoTicket" = tt."idTipoTicket"
        JOIN "Evento" e ON tt."idEvento" = e."idEvento"
        WHERE e."idOrganizacion" = ${idOrganizacion}
        GROUP BY hora
        ORDER BY hora
      `;
    } else {
      ventas = await prisma.$queryRaw<{ hora: Date; ventas: bigint }[]>`
        SELECT date_trunc('hour', "fechaCreacion") as hora, count(*) as ventas
        FROM "Ticket"
        GROUP BY hora
        ORDER BY hora
      `;
    }

    const formattedVentas = ventas.map(v => ({
      ...v,
      ventas: Number(v.ventas)
    }));

    res.status(200).json({
      message: "Ventas por hora obtenidas con éxito",
      data: formattedVentas,
      error: false
    });
  } catch (error) {
    res.status(500).json({ message: "Error al obtener ventas por hora", error: true });
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
  getVentasPorHora
};