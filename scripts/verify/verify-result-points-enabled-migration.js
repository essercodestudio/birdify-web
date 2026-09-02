// Verificação runtime da migration Bloco 2 · Commit 2.1
// (tournament_result_points.enabled TINYINT(1)).
//
// Cenários:
//   1. Rodar migration 1ª vez           -> ADD COLUMN executado
//   2. Rodar migration 2ª vez           -> DO 0 (idempotente)
//   3. Confirmar via information_schema -> coluna enabled TINYINT NOT NULL DEFAULT 1
//   4. Confirmar backfill               -> nenhuma linha existente ficou com enabled != 1
//
// Como rodar (do repo root):
//   cd scripts/verify && node verify-result-points-enabled-migration.js

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '..', 'backend', '.env') });
const mysql = require('mysql2/promise');

const MIGRATION = path.join(__dirname, '..', '..', 'backend', 'migrations', '2026_09_01_result_points_enabled.sql');
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
      `total=${conf.total_config_rows}`,
      `enabled=${conf.enabled_rows}`,
      `disabled=${conf.disabled_rows}`,
      `torneios=${conf.tournaments_with_config}`);
    return conf;
  } finally { await conn.end(); }
}

async function verifyColumn() {
  const conn = await mysql.createConnection(DB_CFG);
  try {
    const [cols] = await conn.execute(
      `SELECT COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, DATA_TYPE
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA=DATABASE()
          AND TABLE_NAME='tournament_result_points'
          AND COLUMN_NAME='enabled'`
    );
    if (!cols.length) { fail('tournament_result_points.enabled AUSENTE'); return; }
    const r = cols[0];
    if (!r.COLUMN_TYPE.startsWith('tinyint'))
      fail(`enabled deveria ser tinyint, veio ${r.COLUMN_TYPE}`);
    else if (r.IS_NULLABLE !== 'NO')
      fail(`enabled deveria ser NOT NULL, veio nullable=${r.IS_NULLABLE}`);
    else if (String(r.COLUMN_DEFAULT) !== '1')
      fail(`enabled default esperado 1, veio ${r.COLUMN_DEFAULT}`);
    else pass('tournament_result_points.enabled tinyint NOT NULL DEFAULT 1 OK');

    // Backfill: nenhuma linha existente ficou desabilitada
    const [[{ n }]] = await conn.query(
      `SELECT COUNT(*) AS n FROM tournament_result_points WHERE enabled != 1`
    );
    if (n !== 0) fail(`backfill errado: ${n} linhas com enabled != 1`);
    else pass('backfill OK: 0 linhas com enabled != 1 (todas herdaram default)');
  } finally { await conn.end(); }
}

(async () => {
  console.log('== executando migration 2x pra provar idempotencia ==');
  const r1 = await runMigration('1a');
  const r2 = await runMigration('2a');
  if (r1 && r2) {
    const same = ['total_config_rows', 'enabled_rows', 'disabled_rows', 'tournaments_with_config']
      .every(k => r1[k] === r2[k]);
    if (!same) fail('idempotencia FALHOU — outputs divergiram entre execucoes');
    else pass('idempotencia OK — outputs identicos nas 2 execucoes');
  }

  console.log('\n== conferindo schema real do banco ==');
  await verifyColumn();

  console.log('\n== RESULTADO ==');
  console.log(failures === 0 ? 'OK PASS' : `FAIL (${failures} falhas)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
