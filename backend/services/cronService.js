const cron = require('node-cron');
const db = require('../db');
const socketService = require('./socketService');

// Fecha treinos abandonados por qualquer um dos dois critérios (o que vier primeiro):
//   1) passaram 8h desde created_at, ou
//   2) o treino é de um dia anterior a hoje (BRT) — treino do dia não atravessa a virada.
// Ativo vira 'finalizado' (marcações valem); aguardando vira 'cancelado'.
async function autoFinalizeStaleTrainings() {
  try {
    const stale = `(created_at < (NOW() - INTERVAL 8 HOUR) OR DATE(created_at) < CURDATE())`;

    const [ativos] = await db.query(
      `SELECT id FROM training_groups WHERE status = 'ativo' AND ${stale}`
    );
    const [cancelados] = await db.query(
      `SELECT id FROM training_groups WHERE status = 'aguardando' AND ${stale}`
    );

    if (ativos.length > 0) {
      await db.query(
        `UPDATE training_groups SET status = 'finalizado'
          WHERE status = 'ativo' AND ${stale}`
      );
    }
    if (cancelados.length > 0) {
      await db.query(
        `UPDATE training_groups SET status = 'cancelado'
          WHERE status = 'aguardando' AND ${stale}`
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
  // timezone explícito — não depende de process.env.TZ do node (defense in depth
  // pra caso o processo suba num container/pm2 sem TZ herdado).
  cron.schedule('0 0 * * * *', autoFinalizeStaleTrainings, { timezone: 'America/Sao_Paulo' });

  // O cron da meia-noite ('59 59 23 * * *') que criava linhas em `tournaments`
  // com nome "Treino AAAA-MM-DD" foi REMOVIDO em 2026-08-28 por dois motivos:
  //
  //  1) Fuso quebrado: `new Date().toISOString().split('T')[0]` converte pra UTC,
  //     então às 23:59 BRT o `dataAmanha` calculado virava dia+2 (não dia+1) —
  //     e o novo "Treino AAAA-MM-DD" aparecia com um dia à frente do esperado
  //     no Dashboard admin, poluindo a lista.
  //  2) Código morto: o único consumidor de `tournaments WHERE name LIKE 'Treino %'`
  //     era esse próprio cron. O ranking do dia real vive em `training_groups`
  //     (módulo Treino atual), populado pela UI. Nenhuma tela lê "Treino %".
  //
  // Registros históricos criados por versões antigas do cron continuam na base
  // (poluição visual no Dashboard admin até o gestor apagar manualmente) — não
  // foram removidos pra evitar mexer em dado sem pedido explícito.
};

module.exports = { initCronJobs, autoFinalizeStaleTrainings };