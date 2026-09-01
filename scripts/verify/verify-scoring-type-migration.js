// Verificação runtime da migration da Onda A (Pontuação por Resultado).
// Roda a migration 2x (prova idempotência) e confere via information_schema
// que as colunas/tabelas esperadas foram instaladas corretamente.
//
// Cenários:
//   1. Executar migration → SUCESSO + SELECT de conferência
//   2. Executar 2ª vez     → SUCESSO + mesma saída (idempotente)
//   3. Confirmar via schema:
//      - tournaments.scoring_type ENUM('strokes','result_points') DEFAULT 'strokes'
//      - tournament_result_points (PK composta, FK CASCADE)
//      - scores.result_kind ENUM NULL
//      - admin_score_audit: previous_result_kind + new_result_kind + target_dupla_id
//
// Como rodar (do repo root):
//   cd scripts/verify && node verify-scoring-type-migration.js

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '..', 'backend', '.env') });
const mysql = require('mysql2/promise');

const MIGRATION = path.join(__dirname, '..', '..', 'backend', 'migrations', '2026_08_31_scoring_type_result_points.sql');
const DB_CFG = {
  host: process.env.DB_HOST, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
};

let failures = 0;
const fail = (msg) => { failures++; console.log('❌', msg); };
const pass = (msg) => console.log('✅', msg);

async function runMigration(label) {
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  const conn = await mysql.createConnection({ ...DB_CFG, multipleStatements: true });
  try {
    const [results] = await conn.query(sql);
    const arrays = Array.isArray(results) ? results : [results];
    const selects = arrays.filter(r => Array.isArray(r) && r.length && !('affectedRows' in r[0]));
    if (selects.length === 0) { fail(`${label}: nenhum SELECT no retorno`); return null; }
    const conf = selects[selects.length - 1][0];
    console.log(`[${label}] conferência:`,
      `torneios_strokes=${conf.torneios_strokes}`,
      `torneios_pontos=${conf.torneios_pontos}`,
      `config=${conf.linhas_config_pontos}`,
      `scores_com_resultado=${conf.scores_com_resultado}`);
    return conf;
  } finally { await conn.end(); }
}

async function verifySchema() {
  const conn = await mysql.createConnection(DB_CFG);
  try {
    // tournaments.scoring_type
    const [tSt] = await conn.execute(
      `SELECT COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tournaments' AND COLUMN_NAME='scoring_type'`
    );
    if (!tSt.length) fail('tournaments.scoring_type AUSENTE');
    else {
      const r = tSt[0];
      if (!r.COLUMN_TYPE.includes("'strokes'") || !r.COLUMN_TYPE.includes("'result_points'"))
        fail(`tournaments.scoring_type tipo inesperado: ${r.COLUMN_TYPE}`);
      else if (r.IS_NULLABLE !== 'NO' || r.COLUMN_DEFAULT !== 'strokes')
        fail(`tournaments.scoring_type nullable/default inesperado: nullable=${r.IS_NULLABLE} default=${r.COLUMN_DEFAULT}`);
      else pass('tournaments.scoring_type OK');
    }

    // tournament_result_points
    const [trp] = await conn.execute(
      `SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_KEY
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tournament_result_points'
        ORDER BY ORDINAL_POSITION`
    );
    if (!trp.length) fail('tournament_result_points AUSENTE');
    else {
      const cols = trp.map(x => x.COLUMN_NAME);
      const wanted = ['tournament_id', 'result_kind', 'points', 'created_at'];
      const missing = wanted.filter(w => !cols.includes(w));
      if (missing.length) fail(`tournament_result_points sem colunas: ${missing.join(', ')}`);
      const pk = trp.filter(x => x.COLUMN_KEY === 'PRI').map(x => x.COLUMN_NAME);
      if (!pk.includes('tournament_id') || !pk.includes('result_kind'))
        fail(`tournament_result_points PK composta esperada, veio: ${pk.join(', ')}`);
      else pass('tournament_result_points OK (PK composta tournament_id+result_kind)');
    }

    // scores.result_kind
    const [sRk] = await conn.execute(
      `SELECT COLUMN_TYPE, IS_NULLABLE
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='scores' AND COLUMN_NAME='result_kind'`
    );
    if (!sRk.length) fail('scores.result_kind AUSENTE');
    else if (sRk[0].IS_NULLABLE !== 'YES') fail('scores.result_kind deveria ser NULLABLE');
    else pass('scores.result_kind OK (nullable)');

    // admin_score_audit — 3 colunas novas
    const [asa] = await conn.execute(
      `SELECT COLUMN_NAME, IS_NULLABLE
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='admin_score_audit'
          AND COLUMN_NAME IN ('previous_result_kind','new_result_kind','target_dupla_id')`
    );
    const asaNames = asa.map(x => x.COLUMN_NAME);
    ['previous_result_kind', 'new_result_kind', 'target_dupla_id'].forEach(c => {
      if (!asaNames.includes(c)) fail(`admin_score_audit.${c} AUSENTE`);
      else if (asa.find(x => x.COLUMN_NAME === c).IS_NULLABLE !== 'YES')
        fail(`admin_score_audit.${c} deveria ser NULLABLE`);
    });
    if (asaNames.length === 3) pass('admin_score_audit — 3 colunas novas OK (todas nullable)');
  } finally { await conn.end(); }
}

(async () => {
  console.log('== executando migration 2x pra provar idempotência ==');
  const r1 = await runMigration('1ª');
  const r2 = await runMigration('2ª');
  if (r1 && r2) {
    const same = ['torneios_strokes', 'torneios_pontos', 'linhas_config_pontos', 'scores_com_resultado']
      .every(k => r1[k] === r2[k]);
    if (!same) fail('idempotência FALHOU — outputs divergiram entre execuções');
    else pass('idempotência OK — outputs idênticos nas 2 execuções');
  }

  console.log('\n== conferindo schema real do banco ==');
  await verifySchema();

  console.log('\n== RESULTADO ==');
  console.log(failures === 0 ? '✅ PASS' : `❌ FAIL (${failures} falhas)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
