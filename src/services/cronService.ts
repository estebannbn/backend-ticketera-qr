import cron from "node-cron";
import { prisma } from "../prisma.js";
import { EstadoEvento, EstadoTicket } from "@prisma/client";

export const startCronJobs = () => {
  // Ejecutar cada 5 minutos para revisar eventos que ya pasaron
  cron.schedule("*/5 * * * *", async () => {
    try {
      const ahora = new Date();

      // UTC-3
      const OFFSET_ARG = -3 * 60 * 60 * 1000;
      const ahoraArg = new Date(Date.now() + OFFSET_ARG);
      const doceHorasAtrasArg = new Date(ahoraArg.getTime() - 12 * 60 * 60 * 1000);

      // Buscar eventos que pasaron hace más de 12 horas y siguen ACTIVOS
      // Comparamos restando el offset para buscar en UTC en la DB, ya que Prisma guarda en UTC.
      const limiteFinalizacionUTC = new Date(doceHorasAtrasArg.getTime() - OFFSET_ARG);

      const eventosFinalizados = await prisma.evento.findMany({
        where: {
          fechaHoraEvento: {
            lt: limiteFinalizacionUTC,
          },
          estado: EstadoEvento.ACTIVO,
        },
        include: {
          tipoTickets: true,
        },
      });

      if (eventosFinalizados.length === 0) return;

      console.log(`CronJob: Se encontraron ${eventosFinalizados.length} eventos para finalizar.`);

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
      console.error("CronJob Error al finalizar eventos:", error);
    }
  });

  console.log("Servicio de Cron Jobs (Tareas Programadas) iniciado.");
};
