// Verificacao runtime da migration 2026_09_09_tournaments_ask_handicap.sql
// (Fase 2 · Mudanca 2 · Commit 2.1).
//
// Roda a migration 2x (prova idempotencia) e confere via information_schema
// que a coluna foi instalada corretamente com o default seguro (1 = pede
// handicap = comportamento historico preservado).
//
// Cenarios:
//   1. Executar migration → SUCESSO + SELECT de conferencia
//   2. Executar 2a vez     → SUCESSO + mesma saida (idempotente)
//   3. Confirmar via schema:
//      - tournaments.ask_handicap TINYINT(1) NOT NULL DEFAULT 1
//      - Todos os torneios existentes com ask_handicap=1 (backfill via DEFAULT)
//
// Como rodar (do repo root):
//   cd scripts/verify && node verify-ask-handicap-migration.js

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '..', 'backend', '.env') });
const mysql = require('mysql2/promise');

const MIGRATION = path.join(__dirname, '..', '..', 'backend', 'migrations', '2026_09_09_tournaments_ask_handicap.sql');
const DB_CFG = {
  host: process.env.DB_HOST, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
};

let failures = 0;
const fail = (msg) => { failures++; console.log('X', msg); };
const pass = (msg) => console.log('OK', msg);

async function runMigration(label) {
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  const conn = await mysql.createConnection({ ...DB_CFG, multipleStatements: true });
  try {
    const [results] = await conn.query(sql);
    const arrays = Array.isArray(results) ? results : [results];
    const selects = arrays.filter(r => Array.isArray(r) && r.length && !('affectedRows' in r[0]));
    if (selects.length === 0) { fail(`${label}: nenhum SELECT no retorno`); return null; }
    const conf = selects[selects.length - 1][0];
    console.log(`[${label}] conferencia:`,
      `total=${conf.total_torneios}`,
      `pedem_handicap=${conf.pedem_handicap}`,
      `nao_pedem=${conf.nao_pedem_handicap}`);
    return conf;
  } finally { await conn.end(); }
}

async function verifySchema() {
  const conn = await mysql.createConnection(DB_CFG);
  try {
    // tournaments.ask_handicap
    const [rows] = await conn.execute(
      `SELECT COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tournaments' AND COLUMN_NAME='ask_handicap'`
    );
    if (!rows.length) { fail('tournaments.ask_handicap AUSENTE'); return; }
    const r = rows[0];
    if (!r.COLUMN_TYPE.toLowerCase().startsWith('tinyint'))
      fail(`tournaments.ask_handicap tipo inesperado: ${r.COLUMN_TYPE}`);
    else if (r.IS_NULLABLE !== 'NO')
      fail(`tournaments.ask_handicap deveria ser NOT NULL, veio: ${r.IS_NULLABLE}`);
    else if (String(r.COLUMN_DEFAULT) !== '1')
      fail(`tournaments.ask_handicap default esperado 1, veio: ${r.COLUMN_DEFAULT}`);
    else pass(`tournaments.ask_handicap OK (${r.COLUMN_TYPE} NOT NULL DEFAULT 1)`);

    // Backfill via DEFAULT: todos torneios existentes com ask_handicap=1
    const [[cnt]] = await conn.execute(
      'SELECT COUNT(*) AS n FROM tournaments WHERE ask_handicap IS NULL OR ask_handicap NOT IN (0,1)'
    );
    if (cnt.n === 0) pass('backfill OK — nenhum torneio com valor invalido');
    else fail(`${cnt.n} torneio(s) com ask_handicap NULL ou fora de {0,1}`);
  } finally { await conn.end(); }
}

(async () => {
  console.log('== executando migration 2x pra provar idempotencia ==');
  const r1 = await runMigration('1a');
  const r2 = await runMigration('2a');
  if (r1 && r2) {
    const same = ['total_torneios', 'pedem_handicap', 'nao_pedem_handicap']
      .every(k => r1[k] === r2[k]);
    if (!same) fail('idempotencia FALHOU — outputs divergiram entre execucoes');
    else pass('idempotencia OK — outputs identicos nas 2 execucoes');
  }

  console.log('\n== conferindo schema real do banco ==');
  await verifySchema();

  console.log('\n== RESULTADO ==');
  console.log(failures === 0 ? 'PASS' : `FAIL (${failures} falhas)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
