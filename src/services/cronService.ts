import cron from "node-cron";
import { prisma } from "../prisma.js";
import { EstadoEvento, EstadoTicket } from "@prisma/client";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

dayjs.extend(utc);
dayjs.extend(timezone);

const TIMEZONE = "America/Argentina/Buenos_Aires";

export const startCronJobs = () => {
  // Ejecutar cada 5 minutos para revisar eventos que ya pasaron
  cron.schedule("*/5 * * * *", async () => {
    console.log("CronJob: Iniciando revisión de eventos finalizados...");
    try {
      // Calculamos el límite en Argentina timezone (UTC-3)
      const ahoraArg = dayjs().tz(TIMEZONE);
      const limiteFinalizacion = ahoraArg.subtract(12, 'hour').toDate();

      const eventosFinalizados = await prisma.evento.findMany({
        where: {
          fechaHoraEvento: {
            lt: limiteFinalizacion,
          },
          estado: EstadoEvento.ACTIVO,
        },
        include: {
          tipoTickets: true,
        },
      });

      console.log(`CronJob: Se encontraron ${eventosFinalizados.length} eventos para finalizar.`);

      if (eventosFinalizados.length === 0) return;

      for (const evento of eventosFinalizados) {
        // 1. Marcar el evento como FINALIZADO
        await prisma.evento.update({
          where: { idEvento: evento.idEvento },
          data: { estado: EstadoEvento.FINALIZADO },
        });

        // 2. Todos los tickets de este evento que estén pendientes, pagados o pendiente_transferencia, pasan a expirados
        for (const tipoTicket of evento.tipoTickets) {
          await prisma.ticket.updateMany({
            where: {
              idTipoTicket: tipoTicket.idTipoTicket,
              estado: {
                in: [
                  EstadoTicket.pendiente,
                  EstadoTicket.pagado,
                  EstadoTicket.pendiente_transferencia,
                ],
              },
            },
            data: {
              estado: EstadoTicket.expirado,
            },
          });
        }
        console.log(
          `CronJob: Evento ID ${evento.idEvento} ('${evento.nombre}') marcado como FINALIZADO y tickets sin usar expirados.`
        );
      }
    } catch (error) {
      console.error("CronJob: Error al finalizar eventos:", error);
    }
  });

  // Ejecutar cada minuto para limpiar tickets pendientes vencidos (5 min)
  cron.schedule("* * * * *", async () => {
    console.log("CronJob: Revisando tickets pendientes vencidos...");
    try {
      const cincoMinutosAtras = dayjs().subtract(5, 'minute').toDate();

      const resultado = await prisma.ticket.updateMany({
        where: {
          estado: EstadoTicket.pendiente,
          fechaCreacion: {
            lt: cincoMinutosAtras
          }
        },
        data: {
          estado: EstadoTicket.expirado
        }
      });

      console.log(`CronJob: Se limpiaron ${resultado.count} tickets pendientes vencidos.`);
    } catch (error) {
      console.error("CronJob: Error al limpiar tickets pendientes:", error);
    }

    // NUEVO: Finalizar eventos sin stock con todos sus tickets consumidos
    try {
      console.log("CronJob: Revisando eventos sin stock para finalizar...");
      const eventosActivos = await prisma.evento.findMany({
        where: { estado: EstadoEvento.ACTIVO },
        include: {
          tipoTickets: {
            include: {
              _count: {
                select: {
                  tickets: {
                    where: { estado: { notIn: [EstadoTicket.reembolsado, EstadoTicket.expirado] } }
                  }
                }
              }
            }
          }
        }
      });

      for (const evento of eventosActivos) {
        // Sumar tickets de todos los tipos del evento
        const totalTicketsValidos = evento.tipoTickets.reduce((acc, tt) => acc + tt._count.tickets, 0);

        if (totalTicketsValidos > 0 && totalTicketsValidos === evento.capacidadMax) {
          // Chequear si todos esos tickets están consumidos
          const countConsumidos = await prisma.ticket.count({
            where: {
              tipoTicket: { idEvento: evento.idEvento },
              estado: EstadoTicket.consumido
            }
          });

          if (countConsumidos === totalTicketsValidos) {
            await prisma.evento.update({
              where: { idEvento: evento.idEvento },
              data: { estado: EstadoEvento.FINALIZADO }
            });
            console.log(`CronJob: Evento ID ${evento.idEvento} finalized because it is full and all tickets are consumed.`);
          }
        }
      }
    } catch (error) {
      console.error("CronJob: Error en verificación de eventos sin stock:", error);
    }
  });


    // Tarea diaria: Marcar como ELIMINADO los eventos FINALIZADOS hace más de 3 meses
    cron.schedule("0 0 * * *", async () => {
      console.log("CronJob: Iniciando limpieza de eventos finalizados hace >3 meses...");
      try {
        const tresMesesAtras = dayjs().subtract(3, 'month').toDate();

        const resultado = await prisma.evento.updateMany({
          where: {
            estado: { in: [EstadoEvento.FINALIZADO, EstadoEvento.CANCELADO] },
            fechaHoraEvento: {
              lt: tresMesesAtras
            }
          },
          data: {
            estado: EstadoEvento.ELIMINADO
          }
        });

        if (resultado.count > 0) {
          console.log(`CronJob: Se pasaron a ELIMINADO ${resultado.count} eventos antiguos.`);
        }
      } catch (error) {
        console.error("CronJob: Error en limpieza de eventos antiguos:", error);
      }
    });

  console.log("Servicio de Cron Jobs (Tareas Programadas) iniciado.");
};
