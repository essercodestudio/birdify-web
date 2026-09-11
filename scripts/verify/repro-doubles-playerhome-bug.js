// REPRODUCAO DO BUG PRE-EXISTENTE: doubles em PlayerHome pula silenciosamente
// o modal HANDICAPS por dupla e vai direto pro Scorecard (mesmo com o torneio
// tendo ask_handicap=1).
//
// Cria torneio doubles com ask_handicap=1 (padrao historico), com dupla e
// grupo escalado. Login como jogador via UI, digita codigo do grupo, observa:
//   A. Modal HANDICAPS abre?
//   B. Se nao, chegou no Scorecard?
//   C. Consegue marcar score (clica no +)?
//   D. Qual eh o valor de handicap salvo no banco?
//
// Testa 2 sub-cenarios:
//   c1) dupla criada SEM handicap (admin nao informou) — pior caso: NULL
//   c2) dupla criada COM handicap=15.0 (admin informou no cadastro) — funciona
//
// Como rodar (backend + frontend ja rodando):
//   cd scripts/verify && node repro-doubles-playerhome-bug.js

const path = require('path');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const { chromium } = require('playwright-core');
require('dotenv').config({ path: path.join(__dirname, '..', '..', 'backend', '.env') });

const DB_CFG = {
  host: process.env.DB_HOST, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
};
const PLAYER_EMAIL = 'repro.dbl.player@test.local';
const P2_EMAIL     = 'repro.dbl.p2@test.local';
const OUT = __dirname;

async function ensureUser(email, name, gender) {
  const conn = await mysql.createConnection(DB_CFG);
  try {
    const hash = await bcrypt.hash('verify123', 10);
    const [ex] = await conn.execute('SELECT id FROM users WHERE email=?', [email]);
    let id;
    if (ex.length) {
      id = ex[0].id;
      await conn.execute('UPDATE users SET password_hash=?, role=?, name=?, gender=? WHERE id=?',
        [hash, 'PLAYER', name, gender, id]);
    } else {
      const [r] = await conn.execute(
        'INSERT INTO users (name, email, password_hash, role, gender) VALUES (?,?,?,?,?)',
        [name, email, hash, 'PLAYER', gender]
      );
      id = r.insertId;
    }
    return id;
  } finally { await conn.end(); }
}

function randCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

async function seedDoublesScenario({ playerId, p2Id, duplaHandicap }) {
  const conn = await mysql.createConnection({ ...DB_CFG, multipleStatements: true });
  try {
    const [[course]] = await conn.query('SELECT id FROM courses WHERE club_id=1 LIMIT 1');
    const label = duplaHandicap == null ? 'dblNoHC' : 'dblHC15';
    const name = `Repro ${label} ${Date.now().toString(36).toUpperCase()}`;
    const start = new Date(Date.now() + 26 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    const [t] = await conn.query(
      `INSERT INTO tournaments
        (club_id, name, start_date, course_id, format, total_rounds,
         scoring_type, modality, ask_handicap, status)
       VALUES (1, ?, ?, ?, 'shotgun', 1, 'strokes', 'doubles', 1, 'OPEN')`,
      [name, start, course.id]
    );
    const tid = t.insertId;
    await conn.query(
      `INSERT INTO tournament_rounds (tournament_id, round_number, round_date, course_id)
       VALUES (?, 1, ?, ?)`,
      [tid, start, course.id]
    );
    await conn.query(
      `INSERT INTO inscriptions (tournament_id, user_id, status)
       VALUES (?, ?, 'APPROVED'), (?, ?, 'APPROVED')`,
      [tid, playerId, tid, p2Id]
    );
    const [d] = await conn.query(
      `INSERT INTO tournament_duplas (tournament_id, dupla_name, handicap)
       VALUES (?, ?, ?)`,
      [tid, `Dupla ${label}`, duplaHandicap]
    );
    const did = d.insertId;
    await conn.query(
      `INSERT INTO tournament_dupla_players (dupla_id, user_id)
       VALUES (?, ?), (?, ?)`,
      [did, playerId, did, p2Id]
    );
    let gid = null, code = null;
    for (let i = 0; i < 20 && gid === null; i++) {
      const candidate = randCode();
      try {
        const [g] = await conn.query(
          `INSERT INTO tournament_groups
            (tournament_id, round_number, group_name, access_code, starting_hole)
           VALUES (?, 1, 'Flight Repro', ?, 1)`,
          [tid, candidate]
        );
        gid = g.insertId; code = candidate;
      } catch (e) { if (e.code !== 'ER_DUP_ENTRY') throw e; }
    }
    await conn.query(
      `INSERT INTO group_duplas (group_id, dupla_id, handicap) VALUES (?, ?, NULL)`,
      [gid, did]
    );
    return { tid, gid, did, access_code: code };
  } finally { await conn.end(); }
}

async function cleanup(tid) {
  const conn = await mysql.createConnection(DB_CFG);
  try {
    await conn.execute(`DELETE FROM scores WHERE tournament_id=?`, [tid]);
    await conn.execute(`DELETE FROM group_duplas WHERE group_id IN (SELECT id FROM tournament_groups WHERE tournament_id=?)`, [tid]);
    await conn.execute(`DELETE FROM tournament_groups WHERE tournament_id=?`, [tid]);
    await conn.execute(`DELETE FROM tournament_dupla_players WHERE dupla_id IN (SELECT id FROM tournament_duplas WHERE tournament_id=?)`, [tid]);
    await conn.execute(`DELETE FROM tournament_duplas WHERE tournament_id=?`, [tid]);
    await conn.execute(`DELETE FROM inscriptions WHERE tournament_id=?`, [tid]);
    await conn.execute(`DELETE FROM tournament_rounds WHERE tournament_id=?`, [tid]);
    await conn.execute(`DELETE FROM tournaments WHERE id=?`, [tid]);
  } finally { await conn.end(); }
}

async function readHandicaps(tid, did) {
  const conn = await mysql.createConnection(DB_CFG);
  try {
    const [[dup]] = await conn.query(
      'SELECT handicap FROM tournament_duplas WHERE id=?', [did]
    );
    const [[gd]] = await conn.query(
      'SELECT handicap FROM group_duplas gd JOIN tournament_groups tg ON gd.group_id=tg.id WHERE tg.tournament_id=? AND gd.dupla_id=?',
      [tid, did]
    );
    const [scores] = await conn.query(
      'SELECT hole_number, strokes FROM scores WHERE tournament_id=? AND dupla_id=? ORDER BY hole_number',
      [tid, did]
    );
    return {
      tournament_duplas_handicap: dup?.handicap ?? null,
      group_duplas_handicap: gd?.handicap ?? null,
      scores,
    };
  } finally { await conn.end(); }
}

async function login(page, email, pwd) {
  await page.goto('http://localhost:3000/login');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(pwd);
  await page.getByRole('button', { name: /entrar/i }).click();
  await page.waitForURL(u => !String(u).endsWith('/login'), { timeout: 15000 });
}

async function runScenario(page, code, label) {
  console.log(`\n=========================================`);
  console.log(`>>> CENARIO: ${label} (code=${code})`);
  console.log(`=========================================`);
  await page.goto('http://localhost:3000/');
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.getByRole('button', { name: /Entendido e Aceito/i }).click().catch(() => {});
  // Abre modal "Entrar na Partida"
  await page.getByText(/Entrar na Partida/i).first().click();
  await page.waitForSelector('input[placeholder="A1B2"]', { timeout: 5000 });
  await page.locator('input[placeholder="A1B2"]').fill(code);
  const shotBefore = path.join(OUT, `repro-doubles__${label}-01-code.png`);
  await page.screenshot({ path: shotBefore, fullPage: true });
  console.log(`screenshot pre-submit: ${shotBefore}`);
  await page.getByRole('button', { name: /COMEÇAR PARTIDA/i }).click();

  // Aguarda ate 5s por: (a) modal HANDICAPS ou (b) navegacao Scorecard
  const outcome = await Promise.race([
    page.getByRole('heading', { name: /^HANDICAPS$/ }).waitFor({ timeout: 5000 })
      .then(() => 'modal_handicaps'),
    page.waitForURL(u => /\/scorecard\/\d+/.test(String(u)), { timeout: 5000 })
      .then(() => 'scorecard'),
  ]).catch(() => 'timeout');
  console.log(`OUTCOME apos submit: ${outcome}`);

  const shotAfter = path.join(OUT, `repro-doubles__${label}-02-after.png`);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: shotAfter, fullPage: true });
  console.log(`screenshot pos-submit: ${shotAfter}`);
  console.log(`URL atual: ${page.url()}`);

  // Se caiu no Scorecard, tenta clicar no + do primeiro card pra confirmar
  // que consegue marcar score
  if (outcome === 'scorecard') {
    // O botao + eh literalmente "+" — em Scorecard.js:1104 é o styles.plus
    try {
      await page.waitForTimeout(2000); // aguarda scorecard hidratar
      const plusBtn = page.getByRole('button', { name: '+' }).first();
      await plusBtn.waitFor({ timeout: 5000 });
      await plusBtn.click();
      await page.waitForTimeout(600);
      await plusBtn.click();
      await page.waitForTimeout(600);
      const shotScore = path.join(OUT, `repro-doubles__${label}-03-score.png`);
      await page.screenshot({ path: shotScore, fullPage: true });
      console.log(`screenshot pos-score: ${shotScore}`);
      console.log(`>> clicou no + duas vezes — consegue marcar score`);
    } catch (e) {
      console.log(`>> nao conseguiu clicar em + : ${e.message}`);
    }
    // aguarda debounce (400ms) + syncService
    await page.waitForTimeout(2500);
  }
  return outcome;
}

(async () => {
  console.log('== seed usuarios ==');
  const playerId = await ensureUser(PLAYER_EMAIL, 'Repro Doubles Player', 'M');
  const p2Id     = await ensureUser(P2_EMAIL, 'Repro Doubles Partner', 'M');
  console.log(`playerId=${playerId} p2Id=${p2Id}`);

  const c1 = await seedDoublesScenario({ playerId, p2Id, duplaHandicap: null });
  const c2 = await seedDoublesScenario({ playerId, p2Id, duplaHandicap: 15.0 });
  console.log(`c1 (sem HC no cadastro): tid=${c1.tid} did=${c1.did} code=${c1.access_code}`);
  console.log(`c2 (HC=15 no cadastro):  tid=${c2.tid} did=${c2.did} code=${c2.access_code}`);

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await ctx.newPage();
  page.on('dialog', async (d) => { console.log(`[dialog] ${d.message()}`); await d.accept(); });
  const pageErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(String(e)); console.log(`[pageerror] ${e}`); });

  try {
    await login(page, PLAYER_EMAIL, 'verify123');

    const out1 = await runScenario(page, c1.access_code, 'c1-sem-hc-no-cadastro');
    const st1 = await readHandicaps(c1.tid, c1.did);
    console.log(`\n>> STATE c1 apos fluxo:`);
    console.log(`   tournament_duplas.handicap = ${st1.tournament_duplas_handicap}`);
    console.log(`   group_duplas.handicap      = ${st1.group_duplas_handicap}`);
    console.log(`   scores gravados            = ${st1.scores.length} row(s) ${JSON.stringify(st1.scores)}`);

    const out2 = await runScenario(page, c2.access_code, 'c2-com-hc-no-cadastro');
    const st2 = await readHandicaps(c2.tid, c2.did);
    console.log(`\n>> STATE c2 apos fluxo:`);
    console.log(`   tournament_duplas.handicap = ${st2.tournament_duplas_handicap}`);
    console.log(`   group_duplas.handicap      = ${st2.group_duplas_handicap}`);
    console.log(`   scores gravados            = ${st2.scores.length} row(s) ${JSON.stringify(st2.scores)}`);

    console.log('\n=========================================');
    console.log('== RESUMO DA REPRODUCAO ==');
    console.log('=========================================');
    console.log(`c1 (sem HC cadastro): outcome=${out1}  hc-final=(td=${st1.tournament_duplas_handicap},gd=${st1.group_duplas_handicap}) scores=${st1.scores.length}`);
    console.log(`c2 (HC=15 cadastro):  outcome=${out2}  hc-final=(td=${st2.tournament_duplas_handicap},gd=${st2.group_duplas_handicap}) scores=${st2.scores.length}`);
    console.log(`pageerrors totais: ${pageErrors.length} ${pageErrors.length ? '(' + pageErrors[0] + ')' : ''}`);
  } finally {
    await browser.close();
    console.log('\n== cleanup ==');
    try { await cleanup(c1.tid); console.log(`limpou c1 tid=${c1.tid}`); } catch (e) { console.log(`X limpar c1: ${e.message}`); }
    try { await cleanup(c2.tid); console.log(`limpou c2 tid=${c2.tid}`); } catch (e) { console.log(`X limpar c2: ${e.message}`); }
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(2); });
