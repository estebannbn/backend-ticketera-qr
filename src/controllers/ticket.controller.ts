// Controlador de Tickets
import { prisma } from "../prisma.js";
import { EstadoTicket } from "@prisma/client";
import { Request, Response } from "express";
import { randomBytes } from "crypto";
import { MercadoPagoConfig, Preference, Payment, PaymentRefund } from "mercadopago";
import QRCode from "qrcode";

// Configuración de Mercado Pago
if (!process.env.MP_ACCESS_TOKEN) {
  throw new Error("MP_ACCESS_TOKEN no está definido en el .env");
}

const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
});

const crearTicket = async (req: Request, res: Response): Promise<void> => {
  try {
    const { idCliente, idTipoTicket } = req.body;

    // 1. Obtener información del tipo de ticket (para el precio y nombre)
    const tipoTicket = await prisma.tipoTicket.findUnique({
      where: { idTipoTicket: Number(idTipoTicket) },
      include: { evento: true }
    });

    if (!tipoTicket) {
      res.status(404).json({
        message: "Tipo de ticket no encontrado",
        error: true,
      });
      return;
    }

    if (tipoTicket.evento?.estado === 'CANCELADO' || tipoTicket.evento?.estado === 'FINALIZADO') {
      res.status(400).json({
        message: "No se pueden comprar tickets para un evento cancelado o finalizado",
        error: true,
      });
      return;
    }

    // Antes de chequear cupos, vencemos tickets pendientes antiguos para este tipo de ticket
    const diezMinutosAtras = new Date(Date.now() - 10 * 60 * 1000);
    await prisma.ticket.updateMany({
      where: {
        idTipoTicket: Number(idTipoTicket),
        estado: 'pendiente',
        fechaCreacion: {
          lt: diezMinutosAtras
        }
      },
      data: {
        estado: 'expirado'
      }
    });

    // 1.b Validar cupos disponibles (CU01 Camino alternativo)
    const ticketsVendidos = await prisma.ticket.count({
      where: {
        idTipoTicket: Number(idTipoTicket),
        estado: { notIn: ['reembolsado', 'expirado'] } // No contamos tickets cancelados
      }
    });

    if (ticketsVendidos >= tipoTicket.cantMaxPorTipo) {
      res.status(400).json({
        message: "Lo sentimos, no hay cupos disponibles para este tipo de ticket (Capacidad agotada)",
        error: true,
      });
      return;
    }

    // 1.c Validar que el cliente exista y control de DNI (CU01)
    const cliente = await prisma.cliente.findUnique({
      where: { idCliente: Number(idCliente) }
    });

    if (!cliente) {
      res.status(404).json({
        message: "El cliente especificado no existe",
        error: true,
      });
      return;
    }

    const ticketPendienteExistente = await prisma.ticket.findFirst({
      where: {
        idCliente: Number(idCliente),
        idTipoTicket: Number(idTipoTicket),
        estado: EstadoTicket.pendiente
      }
    });

    let ticket;

    if (ticketPendienteExistente) {
      // Reutilizar el ticket pendiente existente
      ticket = ticketPendienteExistente;

      // Actualizamos la fecha de creación para darle otros 10 minutos de gracia
      await prisma.ticket.update({
        where: { nroTicket: ticket.nroTicket },
        data: { fechaCreacion: new Date() }
      });
      console.log(`Reutilizando ticket pendiente #${ticket.nroTicket}`);
    } else {
      // 2. Crear un nuevo ticket con estado 'pendiente'
      const tokenQr = randomBytes(16).toString("hex");
      ticket = await prisma.ticket.create({
        data: {
          idCliente: Number(idCliente),
          idTipoTicket: Number(idTipoTicket),
          tokenQr: tokenQr,
          estado: EstadoTicket.pendiente
        } as any,
      });
      console.log(`Creando nuevo ticket pendiente #${ticket.nroTicket}`);
    }

    console.log("Intentando crear preferencia de MP con access token:", process.env.MP_ACCESS_TOKEN ? "DEFINIDO" : "NO DEFINIDO");

    const preference = new Preference(client);

    const preferenceData = {
      body: {
        items: [
          {
            id: ticket.nroTicket.toString(),
            title: `Entrada: ${tipoTicket.evento.nombre} - ${tipoTicket.tipo}`,
            quantity: 1,
            unit_price: Number(tipoTicket.precio),
            currency_id: "ARS"
          }
        ],
        back_urls: {
          success: `${(process.env.FRONTEND_URL || process.env.FRONTEND_LOCAL_URL || 'http://localhost:3000').replace(/['"]/g, '')}/pago-exitoso`,
          failure: `${(process.env.FRONTEND_URL || process.env.FRONTEND_LOCAL_URL || 'http://localhost:3000').replace(/['"]/g, '')}/pago-fallido`,
          pending: `${(process.env.FRONTEND_URL || process.env.FRONTEND_LOCAL_URL || 'http://localhost:3000').replace(/['"]/g, '')}/pago-pendiente`,
        },
        auto_return: "approved",
        notification_url: `${(process.env.BACKEND_URL || 'http://localhost:5000').replace(/['"]/g, '')}/api/tickets/webhook`,
        external_reference: ticket.nroTicket.toString()
      }
    };

    console.log("Datos de preferencia:", JSON.stringify(preferenceData, null, 2));

    const result = await preference.create(preferenceData);

    console.log("Resultado creación preferencia:", result.id ? "EXITO" : "FALLO", result.init_point);

    res.status(200).json({
      message: "Preferencia de Mercado Pago creada",
      data: {
        ticket,
        init_point: result.init_point,
        preferenceId: result.id
      },
      error: false,
    });


  } catch (error) {
    console.error("Error en crearTicket", error);
    res.status(500).json({
      message: "Error al crear el ticket",
      error: true,
      details: (error as Error).message,
    });
  }
};

const procesarPago = async (req: Request, res: Response): Promise<void> => {
  try {
    const { nroTicket, formData } = req.body;

    const ticket = await prisma.ticket.findUnique({
      where: { nroTicket: Number(nroTicket) },
      include: {
        tipoTicket: {
          include: { evento: true }
        }
      }
    });

    if (!ticket) {
      res.status(404).json({ message: "Ticket no encontrado", error: true });
      return;
    }

    if (ticket.estado !== EstadoTicket.pendiente) {
      res.status(400).json({ message: "El ticket no está pendiente de pago", error: true });
      return;
    }

    const payment = new Payment(client);
    const paymentBody = {
      ...formData,
      transaction_amount: Number(ticket.tipoTicket?.precio || formData.transaction_amount),
      description: `Entrada: ${ticket.tipoTicket?.evento?.nombre || 'Evento'} - ${ticket.tipoTicket?.tipo || 'Ticket'}`,
      external_reference: ticket.nroTicket.toString(),
      notification_url: `${(process.env.FRONTEND_URL || process.env.FRONTEND_LOCAL_URL || 'http://localhost:5000').replace(/['"]/g, '')}/api/tickets/webhook`,
    };

    let result;
    try {
      result = await payment.create({ body: paymentBody });
    } catch (mpError: any) {
      console.error("Error creating payment:", mpError);
      res.status(400).json({
        message: "Error al crear pago en Mercado Pago",
        error: true,
        details: mpError.response ? mpError.response : mpError.message
      });
      return;
    }

    const estadoMP = result.status;

    // Si fue aprobado al instante, lo actualizamos y enviamos correo
    if (estadoMP === 'approved') {
      const ticketPagado = await prisma.ticket.update({
        where: { nroTicket: ticket.nroTicket },
        data: {
          estado: EstadoTicket.pagado,
          paymentId: result.id?.toString()
        },
        include: {
          cliente: { include: { usuario: true } },
          tipoTicket: { include: { evento: true } }
        }
      });

      const qrDataURL = await QRCode.toDataURL(ticketPagado.tokenQr);

      // Enviar correo
      if (ticketPagado.cliente?.usuario?.mail) {
        const { sendTicketEmail } = await import("../services/emailService.js");

        const fechaHoraEvento = new Date(ticketPagado.tipoTicket?.evento?.fechaHoraEvento || new Date());

        const OFFSET_ARG = -3 * 60 * 60 * 1000;
        const fechaHoraEvtArg = new Date(fechaHoraEvento.getTime() + OFFSET_ARG);
        const inicioRangoArg = new Date(fechaHoraEvtArg.getTime() - 4 * 60 * 60 * 1000);
        const finRangoArg = new Date(fechaHoraEvtArg.getTime() + 12 * 60 * 60 * 1000);

        const formatterTime = new Intl.DateTimeFormat('es-AR', {
          timeZone: 'America/Argentina/Buenos_Aires',
          hour: '2-digit', minute: '2-digit'
        });

        const timeInicio = formatterTime.format(inicioRangoArg);
        const timeFin = formatterTime.format(finRangoArg);

        await sendTicketEmail(ticketPagado.cliente.usuario.mail, {
          evento: ticketPagado.tipoTicket?.evento?.nombre || "Evento",
          fecha: fechaHoraEvento.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }),
          usuario: `${ticketPagado.cliente.nombre} ${ticketPagado.cliente.apellido}`,
          precio: Number(ticketPagado.tipoTicket?.precio || 0),
          nroTicket: ticketPagado.nroTicket,
          qrData: ticketPagado.tokenQr,
          rangoHorario: `${timeInicio} hs a ${timeFin} hs`
        });
      }

      res.status(200).json({
        message: "Pago aprobado y ticket generado",
        data: { ticket: ticketPagado, status: estadoMP, qr: qrDataURL },
        error: false,
      });
      return;
    }

    // Para cualquier otro estado (rechazado, in_process, pendiente, etc)
    res.status(200).json({
      message: "Pago procesado con estado: " + estadoMP,
      data: { ticket, status: estadoMP, paymentId: result.id },
      error: false,
    });
  } catch (error) {
    console.error("Error en procesarPago:", error);
    res.status(500).json({
      message: "Error interno al procesar pago",
      error: true,
      details: (error as Error).message,
    });
  }
};

const recibirWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    const { query } = req;
    const topic = query.topic || query.type;

    if (topic === "payment") {
      const paymentId = query.id || query["data.id"];
      console.log(`Pago recibido: ${paymentId}`);

      const payment = new Payment(client);
      const paymentData = await payment.get({ id: Number(paymentId) });

      if (paymentData.status === 'approved') {
        const externalReference = paymentData.external_reference;

        if (externalReference) {
          const ticket = await prisma.ticket.update({
            where: { nroTicket: parseInt(externalReference) },
            data: {
              estado: EstadoTicket.pagado,
              paymentId: paymentId.toString()
            },
            include: {
              cliente: {
                include: { usuario: true }
              },
              tipoTicket: {
                include: { evento: true }
              }
            }
          });
          console.log(`Ticket ${externalReference} actualizado a PAGADO.`);

          // Enviar correo
          if (ticket.cliente?.usuario?.mail) {
            const { sendTicketEmail } = await import("../services/emailService.js");

            const fechaHoraEvento = new Date(ticket.tipoTicket?.evento?.fechaHoraEvento || new Date());

            const OFFSET_ARG = -3 * 60 * 60 * 1000;
            const fechaHoraEvtArg = new Date(fechaHoraEvento.getTime() + OFFSET_ARG);
            const inicioRangoArg = new Date(fechaHoraEvtArg.getTime() - 4 * 60 * 60 * 1000);
            const finRangoArg = new Date(fechaHoraEvtArg.getTime() + 12 * 60 * 60 * 1000);

            const formatterTime = new Intl.DateTimeFormat('es-AR', {
              timeZone: 'America/Argentina/Buenos_Aires',
              hour: '2-digit', minute: '2-digit'
            });

            await sendTicketEmail(ticket.cliente.usuario.mail, {
              evento: ticket.tipoTicket?.evento?.nombre || "Evento",
              fecha: fechaHoraEvento.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }),
              usuario: `${ticket.cliente.nombre} ${ticket.cliente.apellido}`,
              precio: Number(ticket.tipoTicket?.precio || 0),
              nroTicket: ticket.nroTicket,
              qrData: ticket.tokenQr,
              rangoHorario: `${formatterTime.format(inicioRangoArg)} hs a ${formatterTime.format(finRangoArg)} hs`
            });
          }
        }
      }
    }
    res.sendStatus(200);
  } catch (error) {
    console.error("Error en webhook", error);
    res.sendStatus(500);
  }
};

const sincronizarPago = async (req: Request, res: Response): Promise<void> => {
  try {
    const { payment_id } = req.body;

    if (!payment_id) {
      res.status(400).json({ message: "Se requiere payment_id", error: true });
      return;
    }

    const payment = new Payment(client);
    const paymentData = await payment.get({ id: Number(payment_id) });

    if (paymentData.status === 'approved') {
      const externalReference = paymentData.external_reference;

      if (externalReference) {
        const ticketExistente = await prisma.ticket.findUnique({
          where: { nroTicket: parseInt(externalReference) }
        });

        if (ticketExistente && ticketExistente.estado === EstadoTicket.pendiente) {
          const ticket = await prisma.ticket.update({
            where: { nroTicket: parseInt(externalReference) },
            data: {
              estado: EstadoTicket.pagado,
              paymentId: payment_id.toString()
            },
            include: {
              cliente: { include: { usuario: true } },
              tipoTicket: { include: { evento: true } }
            }
          });
          console.log(`Ticket ${externalReference} sincronizado a PAGADO vía frontend.`);

          // Enviar correo
          if (ticket.cliente?.usuario?.mail) {
            const { sendTicketEmail } = await import("../services/emailService.js");

            const fechaHoraEvento = new Date(ticket.tipoTicket?.evento?.fechaHoraEvento || new Date());

            const OFFSET_ARG = -3 * 60 * 60 * 1000;
            const fechaHoraEvtArg = new Date(fechaHoraEvento.getTime() + OFFSET_ARG);
            const inicioRangoArg = new Date(fechaHoraEvtArg.getTime() - 4 * 60 * 60 * 1000);
            const finRangoArg = new Date(fechaHoraEvtArg.getTime() + 12 * 60 * 60 * 1000);

            const formatterTime = new Intl.DateTimeFormat('es-AR', {
              timeZone: 'America/Argentina/Buenos_Aires',
              hour: '2-digit', minute: '2-digit'
            });

            await sendTicketEmail(ticket.cliente.usuario.mail, {
              evento: ticket.tipoTicket?.evento?.nombre || "Evento",
              fecha: fechaHoraEvento.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }),
              usuario: `${ticket.cliente.nombre} ${ticket.cliente.apellido}`,
              precio: Number(ticket.tipoTicket?.precio || 0),
              nroTicket: ticket.nroTicket,
              qrData: ticket.tokenQr,
              rangoHorario: `${formatterTime.format(inicioRangoArg)} hs a ${formatterTime.format(finRangoArg)} hs`
            });
          }
        } else {
          console.log(`Ticket ${externalReference} ya estaba pagado o no fue encontrado.`);
        }
      }
    }
    res.status(200).json({ message: "Sincronización completada", error: false });
  } catch (error) {
    console.error("Error en sincronizarPago", error);
    res.status(500).json({
      message: "Error al sincronizar pago",
      error: true,
      details: (error as Error).message,
    });
  }
};

//Obtener Tickets existentes

const obtenerTickets = async (req: Request, res: Response): Promise<void> => {
  try {
    const tickets = await prisma.ticket.findMany({
      include: {
        cliente: {
          select: {
            nombre: true,
            apellido: true,
            tipoDoc: true,
            nroDoc: true,
          },
        },
        tipoTicket: {
          select: {
            precio: true,
            acceso: true,
            evento: {
              select: {
                idEvento: true,
                nombre: true,
                fechaHoraEvento: true,
                idOrganizacion: true,
              },
            },
          },
        },
      },
    });

    res.status(200).json({
      message: "Tickets obtenidos con éxito",
      data: tickets,
      error: false,
    });
  } catch (error) {
    res.status(500).json({
      message: "Error al obtener los Tickets",
      error: true,
      details: (error as Error).message,
    });
  }
};

//Obtener Ticket por ID

const obtenerTicketPorId = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const ticket = await prisma.ticket.findUnique({
      where: { nroTicket: parseInt(id) },
      include: {
        cliente: {
          select: {
            nombre: true,
            apellido: true,
            tipoDoc: true,
            nroDoc: true,
          },
        },
        tipoTicket: {
          select: {
            precio: true,
            acceso: true,
            evento: {
              select: {
                idEvento: true,
                nombre: true,
                fechaHoraEvento: true,
                idOrganizacion: true,
              },
            },
          },
        },
      },
    });

    if (!ticket) {
      res.status(404).json({
        message: "Ticket no encontrado",
        error: true,
      });
      return;
    }

    res.status(200).json({
      message: "Ticket obtenido con éxito",
      data: ticket,
      error: false,
    });
  } catch (error) {
    res.status(500).json({
      message: "Error al obtener el Ticket",
      error: true,
      details: (error as Error).message,
    });
  }
};

const obtenerTicketsPorIdCliente = async (req: Request, res: Response): Promise<void> => {
  try {
    const idCliente = Number(req.params.idCliente);
    // Validar si idCliente existe y es un número válido
    if (!idCliente || isNaN(idCliente)) {
      res.status(400).json({
        message: "El ID de cliente es inválido",
        error: true,
      });
      return;
    }

    // Vencer tickets pendientes de pago más antiguos a 10 minutos
    const diezMinutosAtras = new Date(Date.now() - 10 * 60 * 1000);
    await prisma.ticket.updateMany({
      where: {
        idCliente: idCliente,
        estado: 'pendiente',
        fechaCreacion: {
          lt: diezMinutosAtras
        }
      },
      data: {
        estado: 'expirado'
      }
    });

    const tickets = await prisma.ticket.findMany({
      where: {
        OR: [
          { idCliente: idCliente },
          { ofertaTransferenciaIdCliente: idCliente }
        ],
        NOT: {
          AND: [
            { estado: 'expirado' }
          ]
        }
      },
      include: {
        cliente: {
          select: {
            nombre: true,
            apellido: true,
            tipoDoc: true,
            nroDoc: true,
          },
        },
        tipoTicket: {
          select: {
            precio: true,
            acceso: true,
            evento: {
              select: {
                idEvento: true,
                nombre: true,
                fechaHoraEvento: true,
                idOrganizacion: true,
              },
            },
          },
        },
      },
    });


    res.status(200).json({
      message: "Tickets obtenidos con éxito",
      data: tickets,
      error: false,
    });
  } catch (error) {
    res.status(500).json({
      message: "Error al obtener los tickets",
      error: true,
      details: (error as Error).message,
    });
  }
};


// Consumir Ticket (QR)
const consumirTicket = async (req: Request, res: Response): Promise<void> => {
  try {
    const { tokenQr } = req.params;

    const ticket = await prisma.ticket.findUnique({
      where: { tokenQr },
      include: {
        tipoTicket: {
          include: {
            evento: true
          }
        }
      }
    });

    if (!ticket) {
      res.status(404).json({
        message: "Ticket no encontrado",
        error: true,
      });
      return;
    }

    if (ticket.estado !== 'pagado') {
      let msg = "Solo se pueden consumir tickets pagados";
      if (ticket.estado === 'consumido') msg = "El ticket ya ha sido consumido";
      if (ticket.estado === 'expirado') msg = "El ticket ha expirado";
      if (ticket.estado === 'reembolsado') msg = "El ticket ha sido reembolsado";

      res.status(400).json({
        message: msg,
        error: true,
        estadoActual: ticket.estado
      });
      return;
    }

    // Calcular límites de tiempo para consumo (UTC-3)
    const OFFSET_ARG = -3 * 60 * 60 * 1000;
    const ahoraArg = new Date(Date.now() + OFFSET_ARG);

    // Obtener la fecha del evento en "tiempo absoluto" referenciado a Argentina
    const fechaHoraEvento = ticket.tipoTicket.evento.fechaHoraEvento;
    const fechaEventoArg = new Date(fechaHoraEvento.getTime() + OFFSET_ARG);

    const limiteInicioHora = new Date(fechaEventoArg.getTime() - 4 * 60 * 60 * 1000); // 4 horas antes
    const limiteFinHora = new Date(fechaEventoArg.getTime() + 12 * 60 * 60 * 1000); // 12 horas después

    if (ahoraArg < limiteInicioHora) {
      res.status(400).json({
        message: "El ticket no puede ser consumido todavía. El escaneo inicia 4 horas antes del evento.",
        error: true,
        estadoActual: ticket.estado,
        ticket: ticket,
      });
      return;
    }

    if (ahoraArg > limiteFinHora) {
      res.status(400).json({
        message: "El tiempo válido para consumir este ticket ha expirado. (Límite: 12 hs después del evento)",
        error: true,
        estadoActual: ticket.estado,
        ticket: ticket,
      });
      return;
    }

    const ticketActualizado = await prisma.ticket.update({
      where: { tokenQr },
      data: {
        estado: 'consumido',
        fechaConsumo: new Date()
      } as any,
    });

    res.status(200).json({
      message: "Ticket consumido con éxito. ¡Bienvenido!",
      data: ticketActualizado,
      error: false,
    });
  } catch (error) {
    res.status(500).json({
      message: "Error al consumir el ticket",
      error: true,
      details: (error as Error).message,
    });
  }
};


//Eliminar Ticket

const eliminarTicket = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const ticketEliminado = await prisma.ticket.delete({
      where: { nroTicket: parseInt(id) },
    });

    if (!ticketEliminado) {
      res.status(404).json({
        message: "Ticket no encontrado",
        error: true,
      });
      return;
    }

    res.status(200).json({
      message: "Ticket eliminado con éxito",
      error: false,
    });
  } catch (error) {
    res.status(500).json({
      message: "Error al eliminar el Ticket",
      error: true,
      details: (error as Error).message,
    });
  }
};

//Actualizar Ticket

const actualizarTicket = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const ticketData = req.body;

    const ticketActualizado = await prisma.ticket.update({
      where: { nroTicket: parseInt(id) },
      data: ticketData,
    });

    res.status(200).json({
      message: "Ticket actualizado con éxito",
      data: ticketActualizado,
      error: false,
    });
  } catch (error) {
    res.status(500).json({
      message: "Error al actualizar el Ticket",
      error: true,
      details: (error as Error).message,
    });
  }
};

const transferirTicket = async (req: Request, res: Response): Promise<void> => {
  try {
    const { nroTicket, mailNuevoDueño } = req.body;

    const nuevoDueño = await prisma.usuario.findUnique({
      where: { mail: mailNuevoDueño },
      include: { cliente: true },
    });

    if (!nuevoDueño || !nuevoDueño.cliente) {
      res.status(404).json({
        message: "El usuario destino no existe o no es un cliente",
        error: true,
      });
      return;
    }

    const ticket = await prisma.ticket.findUnique({
      where: { nroTicket: Number(nroTicket) },
      include: { cliente: { include: { usuario: true } } },
    });

    if (!ticket) {
      res.status(404).json({
        message: "Ticket no encontrado",
        error: true,
      });
      return;
    }

    if (ticket.estado !== EstadoTicket.pagado) {
      res.status(400).json({
        message: "Solo se pueden transferir tickets pagados",
        error: true,
      });
      return;
    }

    if (ticket.cliente.usuario.mail === mailNuevoDueño) {
      res.status(400).json({
        message: "No puedes transferir un ticket a ti mismo",
        error: true,
      });
      return;
    }

    const ticketTransferido = await prisma.ticket.update({
      where: { nroTicket: Number(nroTicket) },
      data: {
        estado: EstadoTicket.pendiente_transferencia,
        ofertaTransferenciaIdCliente: nuevoDueño.cliente.idCliente
      },
      include: {
        cliente: { include: { usuario: true } },
        tipoTicket: { include: { evento: true } },
      },
    });

    // Enviar correo de oferta al nuevo dueño
    if (nuevoDueño.mail) {
      const { sendTransferOfferEmail } = await import("../services/emailService.js");
      await sendTransferOfferEmail(nuevoDueño.mail, {
        evento: ticketTransferido.tipoTicket?.evento?.nombre || "Evento",
        usuarioOrigen: `${ticketTransferido.cliente.nombre} ${ticketTransferido.cliente.apellido}`,
        nroTicket: ticketTransferido.nroTicket,
      });
    }

    res.status(200).json({
      message: "Ofrecimiento de transferencia enviado con éxito",
      data: ticketTransferido,
      error: false,
    });
  } catch (error) {
    console.error("Error en transferirTicket", error);
    res.status(500).json({
      message: "Error al transferir el ticket",
      error: true,
      details: (error as Error).message,
    });
  }
};

const aceptarTransferencia = async (req: Request, res: Response): Promise<void> => {
  try {
    const { nroTicket } = req.body;

    const ticket = await prisma.ticket.findUnique({
      where: { nroTicket: Number(nroTicket) },
      include: {
        cliente: { include: { usuario: true } },
        tipoTicket: { include: { evento: true } }
      }
    });

    if (!ticket || ticket.estado !== EstadoTicket.pendiente_transferencia || !ticket.ofertaTransferenciaIdCliente) {
      res.status(400).json({
        message: "No hay una transferencia pendiente válida para este ticket",
        error: true,
      });
      return;
    }

    const antiguoDueñoMail = ticket.cliente.usuario.mail;
    const eventoNombre = ticket.tipoTicket.evento.nombre;

    const ticketActualizado = await prisma.ticket.update({
      where: { nroTicket: Number(nroTicket) },
      data: {
        idCliente: ticket.ofertaTransferenciaIdCliente,
        estado: EstadoTicket.pagado,
        ofertaTransferenciaIdCliente: null
      },
      include: {
        cliente: { include: { usuario: true } }
      }
    });

    // Enviar correo al antiguo dueño avisando que fue aceptado
    if (antiguoDueñoMail) {
      const { sendTransferAcceptedEmail } = await import("../services/emailService.js");
      await sendTransferAcceptedEmail(antiguoDueñoMail, {
        evento: eventoNombre,
        usuarioDestino: `${ticketActualizado.cliente.nombre} ${ticketActualizado.cliente.apellido}`,
        nroTicket: ticketActualizado.nroTicket
      });
    }

    res.status(200).json({
      message: "Transferencia aceptada con éxito",
      data: ticketActualizado,
      error: false,
    });
  } catch (error) {
    console.error("Error en aceptarTransferencia", error);
    res.status(500).json({
      message: "Error al aceptar la transferencia",
      error: true,
    });
  }
};

const rechazarTransferencia = async (req: Request, res: Response): Promise<void> => {
  try {
    const { nroTicket } = req.body;

    const ticket = await prisma.ticket.update({
      where: { nroTicket: Number(nroTicket) },
      data: {
        estado: EstadoTicket.pagado,
        ofertaTransferenciaIdCliente: null
      }
    });

    res.status(200).json({
      message: "Transferencia rechazada con éxito",
      data: ticket,
      error: false,
    });
  } catch (error) {
    console.error("Error en rechazarTransferencia", error);
    res.status(500).json({
      message: "Error al rechazar la transferencia",
      error: true,
    });
  }
};

const reembolsarTicket = async (req: Request, res: Response): Promise<void> => {
  try {
    const { nroTicket } = req.body;

    const ticket = await prisma.ticket.findUnique({
      where: { nroTicket: Number(nroTicket) },
      include: {
        tipoTicket: {
          include: {
            evento: true
          }
        }
      }
    });

    if (!ticket) {
      res.status(404).json({
        message: "Ticket no encontrado",
        error: true,
      });
      return;
    }

    if (ticket.estado !== EstadoTicket.pagado) {
      res.status(400).json({
        message: "Solo se pueden reembolsar tickets pagados",
        error: true,
      });
      return;
    }

    // Validar política de reembolso
    const politica = await prisma.politica.findFirst({
      orderBy: { fechaVigencia: 'desc' }
    });

    const diasLimite = politica?.diasReembolso || 7;
    const fechaEvento = new Date(ticket.tipoTicket.evento.fechaHoraEvento);
    const hoy = new Date();
    const diferenciaDias = (fechaEvento.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24);

    if (diferenciaDias < diasLimite) {
      res.status(400).json({
        message: `No se puede reembolsar. La política requiere al menos ${diasLimite} días de anticipación.`,
        error: true,
      });
      return;
    }

    if (!ticket.paymentId) {
      res.status(400).json({
        message: "No se puede reembolsar el ticket porque no tiene registrado un ID de pago.",
        error: true,
      });
      return;
    }

    try {
      const refund = new PaymentRefund(client);
      await refund.create({ payment_id: Number(ticket.paymentId) });
    } catch (mpError: any) {
      console.error(`Error al procesar reembolso en Mercado Pago para ticket ${ticket.nroTicket}:`, mpError.message || mpError);
      res.status(500).json({
        message: "Error al procesar el reembolso en Mercado Pago",
        error: true,
        details: mpError.response ? mpError.response : mpError.message
      });
      return;
    }

    const ticketReembolsado = await prisma.ticket.update({
      where: { nroTicket: Number(nroTicket) },
      data: { estado: EstadoTicket.reembolsado },
      include: {
        cliente: { include: { usuario: true } },
        tipoTicket: { include: { evento: true } }
      }
    });

    // Enviar correo de reembolso
    if (ticketReembolsado.cliente?.usuario?.mail) {
      const { sendRefundEmail } = await import("../services/emailService.js");
      await sendRefundEmail(ticketReembolsado.cliente.usuario.mail, {
        evento: ticketReembolsado.tipoTicket.evento.nombre,
        usuario: `${ticketReembolsado.cliente.nombre} ${ticketReembolsado.cliente.apellido}`,
        nroTicket: ticketReembolsado.nroTicket,
        monto: Number(ticketReembolsado.tipoTicket.precio)
      });
    }

    res.status(200).json({
      message: "Ticket reembolsado con éxito",
      data: ticketReembolsado,
      error: false,
    });
  } catch (error) {
    console.error("Error en reembolsarTicket", error);
    res.status(500).json({
      message: "Error al reembolsar el ticket",
      error: true,
      details: (error as Error).message,
    });
  }
};

export default {
  crearTicket,
  obtenerTickets,
  obtenerTicketPorId,
  eliminarTicket,
  actualizarTicket,
  obtenerTicketsPorIdCliente,
  consumirTicket,
  recibirWebhook,
  transferirTicket,
  reembolsarTicket,
  aceptarTransferencia,
  rechazarTransferencia,
  procesarPago,
  sincronizarPago
};
