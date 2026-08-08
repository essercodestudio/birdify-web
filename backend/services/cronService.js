const cron = require('node-cron');
const db = require('../db');
const socketService = require('./socketService');

// Fecha treinos abandonados: passaram 8h desde created_at e ninguém encerrou.
// Ativo vira 'finalizado' (marcações valem); aguardando vira 'cancelado'
// (lobby que nunca começou não gera histórico útil).
async function autoFinalizeStaleTrainings() {
  try {
    const [ativos] = await db.query(
      `SELECT id FROM training_groups
        WHERE status = 'ativo'
          AND created_at < (NOW() - INTERVAL 8 HOUR)`
    );
    const [cancelados] = await db.query(
      `SELECT id FROM training_groups
        WHERE status = 'aguardando'
          AND created_at < (NOW() - INTERVAL 8 HOUR)`
    );

    if (ativos.length > 0) {
      await db.query(
        `UPDATE training_groups
            SET status = 'finalizado'
          WHERE status = 'ativo'
            AND created_at < (NOW() - INTERVAL 8 HOUR)`
      );
    }
    if (cancelados.length > 0) {
      await db.query(
        `UPDATE training_groups
            SET status = 'cancelado'
          WHERE status = 'aguardando'
            AND created_at < (NOW() - INTERVAL 8 HOUR)`
      );
    }

    // Notifica salas abertas — jogador na tela do scorecard vê o treino fechar
    // sem precisar dar F5. Ranking do dia também recalcula.
    ativos.forEach(({ id }) => {
      socketService.emitToRoom(`training:${id}`, 'training:finished', { group_id: id, auto: true });
    });
    if (ativos.length > 0 || cancelados.length > 0) {
      socketService.emitToRoom('training:ranking', 'training:ranking_updated', { auto: true });
      console.log(`🕗 Auto-finalize: ${ativos.length} ativos → finalizado, ${cancelados.length} aguardando → cancelado`);
    }
  } catch (err) {
    console.error('❌ Auto-finalize treinos falhou:', { code: err.code, sqlMessage: err.sqlMessage, message: err.message });
  }
}

const initCronJobs = () => {
  // Roda no minuto 0 de cada hora. Um treino que estoura 8h fecha no máximo 1h depois.
  cron.schedule('0 0 * * * *', autoFinalizeStaleTrainings);

  cron.schedule('59 59 23 * * *', async () => {
    console.log("🌙 Iniciando processamento de fecho diário...");

    // Verifica conectividade antes de rodar as operações
    try {
      await db.query("SELECT 1");
    } catch (connErr) {
      console.error("❌ Cron: falha na conexão com o banco:", {
        code:       connErr.code,
        errno:      connErr.errno,
        sqlMessage: connErr.sqlMessage,
        message:    connErr.message,
      });
      return;
    }

    const amanha = new Date();
    amanha.setDate(amanha.getDate() + 1);
    const dataAmanha = amanha.toISOString().split('T')[0];

    let clubs = [];
    try {
      [clubs] = await db.query("SELECT id, name FROM clubs");
    } catch (err) {
      console.error("❌ Cron: erro ao buscar clubes:", { code: err.code, message: err.message });
      return;
    }

    for (const club of clubs) {
      console.log(`⛳ Processando Clube: ${club.name}`);

      try {
        await db.query(
          "UPDATE tournaments SET status = 'concluido' WHERE club_id = ? AND name LIKE 'Treino %' AND status = 'OPEN'",
          [club.id]
        );
      } catch (err) {
        console.error(`❌ Cron [${club.name}]: erro ao fechar treinos:`, { code: err.code, sqlMessage: err.sqlMessage, message: err.message });
      }

      try {
        const [courses] = await db.query("SELECT id FROM courses WHERE club_id = ? LIMIT 1", [club.id]);
        const courseId = courses.length > 0 ? courses[0].id : 1;

        await db.query(
          "INSERT INTO tournaments (name, start_date, course_id, club_id, status) VALUES (?, ?, ?, ?, 'OPEN')",
          [`Treino ${dataAmanha}`, dataAmanha, courseId, club.id]
        );
      } catch (err) {
        console.error(`❌ Cron [${club.name}]: erro ao criar treino amanhã:`, { code: err.code, sqlMessage: err.sqlMessage, message: err.message });
      }
    }

    console.log("✅ Fecho diário concluído!");
  });
};

module.exports = { initCronJobs, autoFinalizeStaleTrainings };