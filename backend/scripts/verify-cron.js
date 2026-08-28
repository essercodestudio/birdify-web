// Valida o cronService após o deploy do fix de 2026-08-28 sem esperar até
// a próxima virada de meia-noite.
//
// Uso (na VPS, depois de git pull + pm2 restart):
//   node backend/scripts/verify-cron.js
//
// Opcional — passa um timestamp ISO (ou "YYYY-MM-DD HH:MM:SS" BRT) pra
// contar quantos "Treino AAAA-MM-DD" foram criados na tabela `tournaments`
// desde então. Se >0 depois do deploy, o cron legado ainda está inserindo
// (bug). Default: última 1 hora.
//   node backend/scripts/verify-cron.js "2026-08-28 20:00:00"
//
// O script:
//   1. Mostra hora BRT/UTC do processo e do MySQL (defense in depth contra fuso torto)
//   2. Reporta a contagem de "Treino %" recentes na tabela `tournaments`
//   3. Executa autoFinalizeStaleTrainings() uma vez e mostra o resultado

const db = require("../db");
const { autoFinalizeStaleTrainings } = require("../services/cronService");

const arg = process.argv[2];
const sinceIso = arg && arg.trim().length > 0 ? arg : null;

(async () => {
  console.log("═════════════════════════════════════════════════════════════");
  console.log(" verify-cron — sanity check pós-deploy do fix do cronService");
  console.log("═════════════════════════════════════════════════════════════\n");

  // 1) Hora do processo
  const now = new Date();
  console.log("⏰ HORA DO PROCESSO");
  console.log("   UTC:", now.toISOString());
  console.log("   BRT:", now.toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }));
  console.log("   TZ env:", process.env.TZ || "(não setado)");
  console.log("");

  // 2) Hora do MySQL
  try {
    const [[row]] = await db.query(
      "SELECT @@session.time_zone AS tz, NOW() AS now_ts, CURDATE() AS today"
    );
    console.log("🗄️  MYSQL (pool session)");
    console.log("   time_zone:", row.tz);
    console.log("   NOW():   ", row.now_ts);
    console.log("   CURDATE():", row.today);
    console.log("");
  } catch (e) {
    console.error("❌ Erro ao ler hora do MySQL:", e.message);
  }

  // 3) Contagem de "Treino AAAA-MM-DD" recentes (o INSERT que foi removido).
  //    Se essa contagem for >0 num intervalo pós-deploy, o cron velho ainda roda.
  const whereClause = sinceIso
    ? "created_at >= ?"
    : "created_at >= NOW() - INTERVAL 1 HOUR";
  const params = sinceIso ? [sinceIso] : [];
  try {
    const [rows] = await db.query(
      `SELECT id, club_id, name, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
         FROM tournaments
        WHERE name LIKE 'Treino %'
          AND ${whereClause}
        ORDER BY created_at DESC
        LIMIT 20`,
      params
    );
    console.log("🕵️  LEGACY 'Treino AAAA-MM-DD' inseridos", sinceIso ? `desde ${sinceIso}` : "na última 1h");
    if (rows.length === 0) {
      console.log("   ✅ Nenhum — o cron legado NÃO está mais criando linhas.");
    } else {
      console.log(`   ⚠️  ${rows.length} linha(s) encontrada(s):`);
      for (const r of rows) {
        console.log(`      #${r.id}  club_id=${r.club_id}  ${r.name}  (${r.created_at})`);
      }
      console.log("   Se esse commit já está em prod, INVESTIGAR — o cron não deveria mais inserir.");
    }
    console.log("");
  } catch (e) {
    console.error("❌ Erro ao contar legados:", e.message);
  }

  // 4) Dispara autoFinalizeStaleTrainings — parte que SOBREVIVEU do cron.
  //    Se roda sem erro e reporta contagens, o job segue funcional.
  console.log("🕗 EXECUTANDO autoFinalizeStaleTrainings() (manual, uma vez)");
  try {
    // A função original só loga quando >0. Antes, coleto contagens pra confirmar
    // que o critério dela bate com o banco (independente do que ela loga).
    const [[stale]] = await db.query(
      `SELECT
         SUM(status = 'ativo'      AND (created_at < (NOW() - INTERVAL 8 HOUR) OR DATE(created_at) < CURDATE())) AS ativos_stale,
         SUM(status = 'aguardando' AND (created_at < (NOW() - INTERVAL 8 HOUR) OR DATE(created_at) < CURDATE())) AS aguardando_stale
         FROM training_groups`
    );
    console.log(`   pré-run: ${Number(stale.ativos_stale || 0)} ativos vencidos, ${Number(stale.aguardando_stale || 0)} aguardando vencidos`);
    await autoFinalizeStaleTrainings();
    console.log("   ✅ Execução manual OK (sem exceção).");
  } catch (e) {
    console.error("   ❌ Erro:", e.message);
  }

  console.log("\n═════════════════════════════════════════════════════════════");
  process.exit(0);
})();
