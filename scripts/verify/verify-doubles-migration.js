// Verificação runtime da migration Onda B · Bloco 3 · Fase B.1 · Commit B1.1
// (tournament_doubles.sql).
//
// Cenários:
//   1. Roda migration 1ª vez -> aplica todos os DDLs
//   2. Roda migration 2ª vez -> DO 0 em tudo (idempotente)
//   3. Confere via information_schema:
//      - tournaments.modality ENUM DEFAULT 'individual'
//      - tournament_duplas + tournament_dupla_players + group_duplas existem
//      - scores.user_id NULLABLE + scores.dupla_id NULLABLE + FK fk_scores_dupla
//      - uk_score DROPADO + uk_score_v2 (5 col) CRIADO
//      - tournament_scorecard_signatures.dupla_id NULLABLE + FK fk_sig_dupla
//      - admin_score_audit.target_dupla_id ganhou FK fk_asa_target_dupla
//   4. Testa UNIQUE novo: aceita 2 rows com mesma (t, hole, round) desde que
//      user_id/dupla_id difiram (comprova NULL como distinct)
//   5. Testa GUARDA: se houver duplicata na chave 4-col, migration ABORTA.
//
// Como rodar (do repo root):
//   cd scripts/verify && node verify-doubles-migration.js

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '..', 'backend', '.env') });
const mysql = require('mysql2/promise');

const MIGRATION = path.join(__dirname, '..', '..', 'backend', 'migrations', '2026_09_01_tournament_doubles.sql');
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
      `indiv=${conf.torneios_individuais}`,
      `doubles=${conf.torneios_duplas}`,
      `duplas=${conf.duplas_cadastradas}`,
      `players=${conf.dupla_players}`,
      `grupos=${conf.grupos_com_duplas}`,
      `sc_dupla=${conf.scores_de_dupla}`,
      `entity_ref_col=${conf.entity_ref_col_installed}`,
      `ukV2_uses_entity=${conf.uk_v2_uses_entity_ref}`,
      `ukOld=${conf.uk_score_legacy_still_there}`);
    return conf;
  } finally { await conn.end(); }
}

async function verifySchema() {
  const conn = await mysql.createConnection(DB_CFG);
  try {
    // tournaments.modality
    const [tM] = await conn.execute(
      `SELECT COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tournaments' AND COLUMN_NAME='modality'`
    );
    if (!tM.length) fail('tournaments.modality AUSENTE');
    else if (!tM[0].COLUMN_TYPE.includes("'individual'") || !tM[0].COLUMN_TYPE.includes("'doubles'"))
      fail(`tournaments.modality tipo inesperado: ${tM[0].COLUMN_TYPE}`);
    else if (tM[0].IS_NULLABLE !== 'NO' || tM[0].COLUMN_DEFAULT !== 'individual')
      fail(`tournaments.modality nullable/default inesperado: nullable=${tM[0].IS_NULLABLE} default=${tM[0].COLUMN_DEFAULT}`);
    else pass('tournaments.modality ENUM NOT NULL DEFAULT individual OK');

    // Tabelas novas
    for (const tbl of ['tournament_duplas', 'tournament_dupla_players', 'group_duplas']) {
      const [[{ n }]] = await conn.query(
        `SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?`,
        [tbl]
      );
      if (n !== 1) fail(`tabela ${tbl} AUSENTE`);
      else pass(`tabela ${tbl} criada`);
    }

    // scores.user_id NULLABLE + dupla_id NULLABLE
    const [scoreCols] = await conn.execute(
      `SELECT COLUMN_NAME, IS_NULLABLE FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='scores' AND COLUMN_NAME IN ('user_id','dupla_id')`
    );
    const scoreColMap = Object.fromEntries(scoreCols.map(c => [c.COLUMN_NAME, c.IS_NULLABLE]));
    if (scoreColMap.user_id !== 'YES') fail(`scores.user_id deveria ser NULLABLE, veio ${scoreColMap.user_id}`);
    else pass('scores.user_id agora eh NULLABLE');
    if (scoreColMap.dupla_id !== 'YES') fail(`scores.dupla_id AUSENTE ou NOT NULL`);
    else pass('scores.dupla_id NULLABLE criado');

    // FK fk_scores_dupla
    const [[{ n: fkSD }]] = await conn.query(
      `SELECT COUNT(*) n FROM information_schema.TABLE_CONSTRAINTS
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='scores' AND CONSTRAINT_NAME='fk_scores_dupla'`
    );
    if (fkSD !== 1) fail('FK fk_scores_dupla AUSENTE');
    else pass('FK fk_scores_dupla instalada');

    // uk_score DROPADO
    const [[{ n: ukOld }]] = await conn.query(
      `SELECT COUNT(*) n FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='scores' AND INDEX_NAME='uk_score'`
    );
    if (ukOld !== 0) fail('uk_score legado ainda presente — deveria ter sido dropado');
    else pass('uk_score legado dropado');

    // entity_ref (coluna REAL, NAO gerada) + uk_score_v2 sobre entity_ref
    const [entityCol] = await conn.execute(
      `SELECT COLUMN_TYPE, IS_NULLABLE, EXTRA FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='scores' AND COLUMN_NAME='entity_ref'`
    );
    if (!entityCol.length) fail('scores.entity_ref AUSENTE');
    else if (entityCol[0].IS_NULLABLE !== 'NO')
      fail(`entity_ref deveria ser NOT NULL, veio nullable=${entityCol[0].IS_NULLABLE}`);
    else if (String(entityCol[0].EXTRA || '').includes('GENERATED'))
      fail(`entity_ref NAO deveria ser gerada (EXTRA=${entityCol[0].EXTRA})`);
    else pass(`scores.entity_ref INT NOT NULL (coluna real preenchida pelo controller)`);

    // Backfill: todo score existente deve ter entity_ref = user_id (todos individuais)
    const [[{ n: badBackfill }]] = await conn.query(
      `SELECT COUNT(*) n FROM scores WHERE entity_ref != user_id OR entity_ref IS NULL`
    );
    if (badBackfill !== 0) fail(`${badBackfill} scores com entity_ref divergente de user_id`);
    else pass('backfill OK: todos scores existentes têm entity_ref = user_id');

    const [ukV2Cols] = await conn.execute(
      `SELECT COLUMN_NAME, SEQ_IN_INDEX FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='scores' AND INDEX_NAME='uk_score_v2'
        ORDER BY SEQ_IN_INDEX`
    );
    const ukCols = ukV2Cols.map(c => c.COLUMN_NAME).join(',');
    const wanted = 'tournament_id,entity_ref,hole_number,round_number';
    if (ukCols !== wanted) fail(`uk_score_v2 cols esperado ${wanted}, veio ${ukCols}`);
    else pass('uk_score_v2 (4 col via entity_ref) criado com ordem correta');

    // tournament_scorecard_signatures.dupla_id + FK
    const [[sig]] = await conn.query(
      `SELECT IS_NULLABLE FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tournament_scorecard_signatures' AND COLUMN_NAME='dupla_id'`
    );
    if (!sig || sig.IS_NULLABLE !== 'YES') fail('tournament_scorecard_signatures.dupla_id AUSENTE ou NOT NULL');
    else pass('tournament_scorecard_signatures.dupla_id NULLABLE OK');
    const [[{ n: fkSigDup }]] = await conn.query(
      `SELECT COUNT(*) n FROM information_schema.TABLE_CONSTRAINTS
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tournament_scorecard_signatures' AND CONSTRAINT_NAME='fk_sig_dupla'`
    );
    if (fkSigDup !== 1) fail('FK fk_sig_dupla AUSENTE');
    else pass('FK fk_sig_dupla instalada');

    // admin_score_audit — FK fk_asa_target_dupla
    const [[{ n: fkAudDup }]] = await conn.query(
      `SELECT COUNT(*) n FROM information_schema.TABLE_CONSTRAINTS
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='admin_score_audit' AND CONSTRAINT_NAME='fk_asa_target_dupla'`
    );
    if (fkAudDup !== 1) fail('FK fk_asa_target_dupla AUSENTE em admin_score_audit');
    else pass('FK fk_asa_target_dupla instalada em admin_score_audit');
  } finally { await conn.end(); }
}

async function verifyUniqueDistinctNull() {
  // Prova pratica: MySQL trata NULL como DISTINCT em UNIQUE. Insere 2 rows
  // com mesma (t, hole, round) mas dupla_id diferente e user_id NULL nos 2 —
  // NAO deve dar conflito.
  const conn = await mysql.createConnection(DB_CFG);
  try {
    // Cria torneio + 2 duplas efemeras
    const [[c]] = await conn.query('SELECT id FROM courses WHERE club_id=1 LIMIT 1');
    const start = new Date(Date.now() + 26*3600*1000).toISOString().slice(0,19).replace('T',' ');
    const [t] = await conn.query(
      `INSERT INTO tournaments (club_id, name, start_date, course_id, format, total_rounds, modality, status)
       VALUES (1, ?, ?, ?, 'shotgun', 1, 'doubles', 'OPEN')`,
      [`Verify UNIQUE distinct-null ${Date.now().toString(36)}`, start, c.id]
    );
    const tid = t.insertId;
    await conn.execute(`INSERT INTO tournament_rounds (tournament_id, round_number, round_date, course_id) VALUES (?, 1, ?, ?)`, [tid, start, c.id]);
    const [d1] = await conn.execute(`INSERT INTO tournament_duplas (tournament_id, dupla_name) VALUES (?, 'D1')`, [tid]);
    const [d2] = await conn.execute(`INSERT INTO tournament_duplas (tournament_id, dupla_name) VALUES (?, 'D2')`, [tid]);
    // Prova positiva: 2 duplas distintas, mesmo hole/round — entity_ref difere
    await conn.execute(
      `INSERT INTO scores (tournament_id, user_id, dupla_id, entity_ref, hole_number, round_number, strokes) VALUES (?, NULL, ?, ?, 1, 1, 4)`,
      [tid, d1.insertId, -d1.insertId]
    );
    try {
      await conn.execute(
        `INSERT INTO scores (tournament_id, user_id, dupla_id, entity_ref, hole_number, round_number, strokes) VALUES (?, NULL, ?, ?, 1, 1, 5)`,
        [tid, d2.insertId, -d2.insertId]
      );
      pass('uk_score_v2 permite 2 rows na mesma (t, hole, round) com dupla_id diferente (entity_ref distinto)');
    } catch (e) {
      fail(`uk_score_v2 rejeitou duplas distintas indevidamente: ${e.code}`);
    }
    // Prova negativa: 2 rows da MESMA dupla, mesmo hole/round → entity_ref igual → REJEITA
    try {
      await conn.execute(
        `INSERT INTO scores (tournament_id, user_id, dupla_id, entity_ref, hole_number, round_number, strokes) VALUES (?, NULL, ?, ?, 1, 1, 6)`,
        [tid, d1.insertId, -d1.insertId]
      );
      fail('uk_score_v2 deveria ter REJEITADO 2 rows da mesma dupla no mesmo hole/round');
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') pass('uk_score_v2 rejeita corretamente duplicata da MESMA dupla');
      else fail(`erro inesperado: ${e.code}`);
    }
    // Cleanup
    await conn.execute(`DELETE FROM scores WHERE tournament_id = ?`, [tid]);
    await conn.execute(`DELETE FROM tournament_dupla_players WHERE dupla_id IN (?, ?)`, [d1.insertId, d2.insertId]);
    await conn.execute(`DELETE FROM tournament_duplas WHERE tournament_id = ?`, [tid]);
    await conn.execute(`DELETE FROM tournaments WHERE id = ?`, [tid]);
  } finally { await conn.end(); }
}

async function verifyGuardAbortsOnDup() {
  // Insere duplicata artificial na chave 4-col ANTES de rodar migration,
  // roda a migration esperando SIGNAL '45000', confirma erro, limpa duplicata.
  const conn = await mysql.createConnection({ ...DB_CFG, multipleStatements: true });
  try {
    await conn.execute(`ALTER TABLE scores DROP INDEX uk_score_v2`);
    const [[c]] = await conn.query('SELECT id FROM courses WHERE club_id=1 LIMIT 1');
    const start = new Date(Date.now() + 26*3600*1000).toISOString().slice(0,19).replace('T',' ');
    const [t] = await conn.query(
      `INSERT INTO tournaments (club_id, name, start_date, course_id, format, total_rounds, status)
       VALUES (1, ?, ?, ?, 'shotgun', 1, 'OPEN')`,
      [`Verify GUARD dup ${Date.now().toString(36)}`, start, c.id]
    );
    const tid = t.insertId;
    await conn.execute(`INSERT INTO tournament_rounds (tournament_id, round_number, round_date, course_id) VALUES (?, 1, ?, ?)`, [tid, start, c.id]);
    const [[anyU]] = await conn.query(`SELECT id FROM users LIMIT 1`);
    const uid = anyU?.id;
    if (!uid) { console.log('WARN: sem users no banco, pulando teste da guarda'); return; }
    await conn.execute(`INSERT INTO scores (tournament_id, user_id, entity_ref, hole_number, round_number, strokes) VALUES (?, ?, ?, 1, 1, 4)`, [tid, uid, uid]);
    await conn.execute(`INSERT INTO scores (tournament_id, user_id, entity_ref, hole_number, round_number, strokes) VALUES (?, ?, ?, 1, 1, 5)`, [tid, uid, uid]);
    const sql = fs.readFileSync(MIGRATION, 'utf8');
    let aborted = false;
    try {
      await conn.query(sql);
    } catch (e) {
      if (e.code === 'ER_NO_SUCH_TABLE' && String(e.sqlMessage || e.message).includes('abort_scores_')) {
        aborted = true;
        pass(`GUARDA disparou: ER_NO_SUCH_TABLE com nome descritivo — ${(e.sqlMessage || e.message).slice(0,140)}`);
      } else {
        fail(`erro inesperado na guarda: ${e.code} ${e.sqlState} ${e.sqlMessage || e.message}`);
      }
    }
    if (!aborted) fail('GUARDA nao bloqueou migration com duplicata artificial');
    // Cleanup: apaga duplicata, roda migration limpa pra restaurar uk_score_v2
    await conn.execute(`DELETE FROM scores WHERE tournament_id = ?`, [tid]);
    await conn.execute(`DELETE FROM tournaments WHERE id = ?`, [tid]);
    await conn.query(sql); // agora sem duplicata, roda ate o fim
  } finally { await conn.end(); }
}

(async () => {
  console.log('== executando migration 2x pra provar idempotencia ==');
  const r1 = await runMigration('1a');
  const r2 = await runMigration('2a');
  if (r1 && r2) {
    const same = ['torneios_individuais', 'torneios_duplas', 'duplas_cadastradas',
                  'dupla_players', 'grupos_com_duplas', 'scores_de_dupla',
                  'entity_ref_col_installed', 'uk_v2_uses_entity_ref', 'uk_score_legacy_still_there']
      .every(k => r1[k] === r2[k]);
    if (!same) fail('idempotencia FALHOU — outputs divergiram entre execucoes');
    else pass('idempotencia OK — outputs identicos nas 2 execucoes');
  }

  console.log('\n== conferindo schema real do banco ==');
  await verifySchema();

  console.log('\n== testando UNIQUE novo aceita NULL user_id distinto ==');
  await verifyUniqueDistinctNull();

  console.log('\n== testando GUARDA aborta com duplicata artificial ==');
  await verifyGuardAbortsOnDup();

  console.log('\n== RESULTADO ==');
  console.log(failures === 0 ? 'OK PASS' : `FAIL (${failures} falhas)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
