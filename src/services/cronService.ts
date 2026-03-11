import cron from "node-cron";
import { prisma } from "../prisma.js";
import { EstadoEvento, EstadoTicket } from "@prisma/client";

export const startCronJobs = () => {
  // Ejecutar cada 5 minutos para revisar eventos que ya pasaron
  cron.schedule("*/5 * * * *", async () => {
    try {
      // Usamos el tiempo UTC actual directamente ya que Prisma almacena en UTC.
      // Esto hace que el cálculo sea independiente de si el servidor está en Washington (iad1) o Londres.
      const ahoraUTC = new Date();

      // Consideramos que un evento ha finalizado 12 horas después de su inicio
      const limiteFinalizacionUTC = new Date(ahoraUTC.getTime() - 12 * 60 * 60 * 1000);

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
