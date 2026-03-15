import { Request, Response } from "express";
import { prisma } from "../prisma.js";
import { MercadoPagoConfig, PaymentRefund } from "mercadopago";
import { sendEventCancellationEmail, sendEventDateChangeEmail, sendRefundEmail } from "../services/emailService.js";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

dayjs.extend(utc);
dayjs.extend(timezone);

const TIMEZONE = "America/Argentina/Buenos_Aires";

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

    const nuevaFecha = dayjs.tz(fechaHoraEvento, TIMEZONE).toDate();

    // Obtener la política actual
    const politica = await prisma.politica.findFirst({
      orderBy: {
        fechaVigencia: 'desc'
      }
    });

    const diasReembolso = politica?.diasReembolso || 0;

    // Calcular la fecha mínima permitida (hoy + diasReembolso)
    // Considerando la zona horaria UTC-3 (Argentina)
    const fechaMinima = dayjs().tz(TIMEZONE).startOf('day').add(diasReembolso, 'day').toDate();

    if (nuevaFecha < fechaMinima) {
      res.status(400).json({
        message: `La fecha del evento debe ser al menos ${diasReembolso} días posterior al día de hoy, según la política de reembolsos vigente.`,
        error: true
      });
      return;
    }

    // CU04 Paso 5.b: Validar suma de capacidades de tipos de tickets
    if (tipoTickets && tipoTickets.length > 0) {
      const sumCapacidades = tipoTickets.reduce((acc: number, tt: any) => acc + Number(tt.cantMaxPorTipo || 0), 0);
      if (sumCapacidades > capacidadMax) {
        res.status(400).json({
          message: "La suma de las capacidades de los tipos de ticket no puede ser mayor a la capacidad máxima del evento.",
          error: true
        });
        return;
      }
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

    // Verificar si el evento existe antes de intentar eliminar
    const eventoExistente = await prisma.evento.findUnique({
      where: { idEvento: id }
    });

    if (!eventoExistente) {
      return res.status(404).json({ message: "El evento no existe o ya fue eliminado.", error: true });
    }

    // Primero eliminamos todos los tickets asociados a través de los TipoTicket
    await prisma.ticket.deleteMany({
      where: {
        tipoTicket: {
          idEvento: id
        }
      }
    });

    // Ahora eliminamos el evento
    await prisma.evento.delete({
      where: { idEvento: id }
    });

    res.status(200).json({
      message: "Evento eliminado con éxito",
      error: false
    });
  } catch (error: any) {
    console.error("Error al eliminar evento:", error);
    res.status(500).json({ 
      message: "Error al eliminar evento", 
      error: true,
      details: error.code === 'P2003' ? "No se puede eliminar porque existen registros relacionados." : error.message
    });
  }
};

const cambiarFechaEvento = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { fechaHoraEvento } = req.body;

    const nuevaFecha = dayjs.tz(fechaHoraEvento, TIMEZONE).toDate();

    // Obtener la política actual
    const politica = await prisma.politica.findFirst({
      orderBy: {
        fechaVigencia: 'desc'
      }
    });

    const diasReembolso = politica?.diasReembolso || 0;

    // Calcular la fecha mínima permitida (hoy + diasReembolso)
    const fechaMinima = dayjs().tz(TIMEZONE).startOf('day').add(diasReembolso, 'day').toDate();

    const eventoPrevio = await prisma.evento.findUnique({
      where: { idEvento: id }
    });

    if (!eventoPrevio) {
      return res.status(404).json({ message: "Evento no encontrado", error: true });
    }

    if (eventoPrevio.estado !== "ACTIVO") {
      return res.status(400).json({
        message: `No se puede cambiar la fecha de un evento que no está ACTIVO (Estado actual: ${eventoPrevio.estado}).`,
        error: true
      });
    }

    const fechaAntiguaOriginal = eventoPrevio.fechaHoraEvento;

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

    const fechaFormateada = dayjs(nuevaFecha).tz(TIMEZONE).format('DD/MM/YYYY HH:mm');
    const fechaAntiguaFormateada = dayjs(fechaAntiguaOriginal).tz(TIMEZONE).format('DD/MM/YYYY HH:mm');

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
          // Reembolso simulado igual al de ticket.controller.ts
          console.log(`Simulando reembolso para Ticket #${ticket.nroTicket} (Payment ID: ${ticket.paymentId}) por cancelación de evento.`);

          await prisma.ticket.update({
            where: { nroTicket: ticket.nroTicket },
            data: { estado: "reembolsado" }
          });

          // Obtener info del monto (precio del tipo de ticket)
          const tipoTicket = await prisma.tipoTicket.findUnique({
            where: { idTipoTicket: ticket.idTipoTicket }
          });

          // Enviar mail de reembolso individual
          await sendRefundEmail(ticket.cliente.usuario.mail, {
            evento: evento.nombre,
            usuario: `${ticket.cliente.nombre} ${ticket.cliente.apellido}`,
            nroTicket: ticket.nroTicket,
            monto: Number(tipoTicket?.precio || 0)
          });

          reembolsadosCount++;
        } catch (err: any) {
          console.error(`Error al procesar simulación de reembolso para ticket ${ticket.nroTicket}:`, err.message || err);
          erroresCount++;
        }
      } else if (["pendiente", "pendiente_transferencia"].includes(ticket.estado)) {
        await prisma.ticket.update({
          where: { nroTicket: ticket.nroTicket },
          data: { estado: "expirado" }
        });
      }
    }

    const fechaCanceladaFormateada = dayjs(evento.fechaHoraEvento).tz(TIMEZONE).format('DD/MM/YYYY HH:mm');

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
    const { fechaInicio, fechaFin } = req.query;
    const idOrganizacion = idOrganizacionStr ? Number(idOrganizacionStr) : undefined;

    const whereClause: any = idOrganizacion ? { idOrganizacion } : {};
    
    // Filtro por rango de fechas (opcional)
    if (fechaInicio || fechaFin) {
      whereClause.fechaHoraEvento = {};
      if (fechaInicio) whereClause.fechaHoraEvento.gte = dayjs(fechaInicio as string).startOf('day').toDate();
      if (fechaFin) whereClause.fechaHoraEvento.lte = dayjs(fechaFin as string).endOf('day').toDate();
    }

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
          if (["pagado", "consumido", "pendiente_transferencia", "reembolsado", "expirado"].includes(ticket.estado)) {
            vendidos++;
            if (ticket.estado === "reembolsado") {
              reembolsados++;
            } else {
              recaudacion += precio;
            }

            if (ticket.cliente && ticket.cliente.fechaNacimiento) {
              const edad = dayjs().diff(dayjs(ticket.cliente.fechaNacimiento), 'year');
              sumaEdades += edad;
              clientesContados++;
            }
          }
        });
      });

      return {
        idCategoria: evento.idCategoria,
        idEvento: evento.idEvento,
        nombre: evento.nombre, // CU feedback mentions 'titulo' is not in table, we use 'nombre'
        foto: evento.foto,
        fecha: evento.fechaHoraEvento,
        vendidos,
        reembolsados,
        porcReembolsados: vendidos > 0 ? (reembolsados / vendidos) * 100 : 0,
        recaudacion, // Required by CU13
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
    console.error("Error en getEstadisticas:", error);
    res.status(500).json({ message: "Error al obtener estadísticas", error: true });
  }
};

const getVentasPorHora = async (req: Request, res: Response) => {
  try {
    const { fechaInicio, fechaFin, idCategoria, idEvento, idTipoTicket, idOrganizacion } = req.query;

    const timezoneStr = 'America/Argentina/Buenos_Aires';
    const localTimestamp = `t."fechaCreacion" AT TIME ZONE 'UTC' AT TIME ZONE '${timezoneStr}'`;

    let conditions: string[] = ["t.estado IN ('pagado', 'consumido', 'pendiente_transferencia', 'expirado')"];

    if (idOrganizacion) conditions.push(`e."idOrganizacion" = ${Number(idOrganizacion)}`);
    if (idCategoria) conditions.push(`e."idCategoria" = ${Number(idCategoria)}`);
    if (idEvento) conditions.push(`e."idEvento" = ${Number(idEvento)}`);
    if (idTipoTicket) conditions.push(`tt."idTipoTicket" = ${Number(idTipoTicket)}`);
    if (fechaInicio) conditions.push(`${localTimestamp} >= '${fechaInicio}'`);
    if (fechaFin) conditions.push(`${localTimestamp} <= '${fechaFin} 23:59:59'`);

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Query para obtener cantidad y recaudación agrupados por hora (normalizado a Argentina)
    const query = `
      SELECT 
        to_char(date_trunc('hour', ${localTimestamp}), 'HH24:00') as hora, 
        count(*)::integer as cantidad, 
        sum(tt.precio)::float as recaudacion
      FROM "Ticket" t
      JOIN "TipoTicket" tt ON t."idTipoTicket" = tt."idTipoTicket"
      JOIN "Evento" e ON tt."idEvento" = e."idEvento"
      ${whereClause}
      GROUP BY date_trunc('hour', ${localTimestamp})
      ORDER BY date_trunc('hour', ${localTimestamp})
    `;

    const ventas = await prisma.$queryRawUnsafe<any[]>(query);

    res.status(200).json({
      message: "Ventas por hora obtenidas con éxito",
      data: ventas,
      error: false
    });
  } catch (error) {
    console.error("Error en getVentasPorHora:", error);
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