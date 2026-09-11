// Verificacao runtime da Fase 2 · Commit 2.5.
//
// ask_handicap=0 esconde HDCP/NET/TEE no Scorecard e "(HC XX)" no Leaderboard.
//
// Cria 2 torneios individual (strokes) — ask_handicap=1 (baseline) e =0 (teste).
// Escala verify.player nos dois grupos com scores gravados via HTTP; abre
// Scorecard/Leaderboard via UI e verifica presenca/ausencia de textos.
//
// Requisitos: backend 3001 + frontend CRA 3000.
// Como rodar: cd scripts/verify && node verify-ask-handicap-hide-net.js

const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const { chromium } = require('playwright-core');
require('dotenv').config({ path: path.join(__dirname, '..', '..', 'backend', '.env') });
const jwt = require(path.join(__dirname, '..', '..', 'backend', 'node_modules', 'jsonwebtoken'));

const DB_CFG = {
  host: process.env.DB_HOST, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
};
const PLAYER_EMAIL = 'verify.hidenet.player@test.local';
const PLAYER_PWD   = 'verify123';
const OUT = __dirname;

let failures = 0;
const fail = (m) => { failures++; console.log('X', m); };
const pass = (m) => console.log('OK', m);

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

// Cria torneio individual (strokes) com uma categoria Gross + jogador com
// scores gravados. Se `hcInGroup !== null` grava em group_players.handicap
// pra o torneio ah=1 (baseline realista).
async function seed({ askHandicap, playerId, hcInGroup }) {
  const conn = await mysql.createConnection({ ...DB_CFG, multipleStatements: true });
  try {
    const [[course]] = await conn.query('SELECT id FROM courses WHERE club_id=1 LIMIT 1');
    const label = `ah${askHandicap}`;
    const name = `Verify HideNet ${label} ${Date.now().toString(36).toUpperCase()}`;
    const start = new Date(Date.now() + 26 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    const [t] = await conn.query(
      `INSERT INTO tournaments
        (club_id, name, start_date, course_id, format, total_rounds,
         scoring_type, modality, ask_handicap, status)
       VALUES (1, ?, ?, ?, 'shotgun', 1, 'strokes', 'individual', ?, 'OPEN')`,
      [name, start, course.id, askHandicap]
    );
    const tid = t.insertId;
    await conn.query(
      `INSERT INTO tournament_rounds (tournament_id, round_number, round_date, course_id)
       VALUES (?, 1, ?, ?)`,
      [tid, start, course.id]
    );
    await conn.query(
      `INSERT INTO tournament_categories (tournament_id, name) VALUES (?, 'Masculino Gross (M0)')`,
      [tid]
    );
    const [[cat]] = await conn.query(
      `SELECT id FROM tournament_categories WHERE tournament_id=? LIMIT 1`, [tid]
    );
    await conn.query(
      `INSERT INTO inscriptions (tournament_id, user_id, category_id, status)
       VALUES (?, ?, ?, 'APPROVED')`,
      [tid, playerId, cat.id]
    );
    let gid = null, code = null;
    for (let i = 0; i < 20 && gid === null; i++) {
      const candidate = randCode();
      try {
        const [g] = await conn.query(
          `INSERT INTO tournament_groups
            (tournament_id, round_number, group_name, access_code, starting_hole)
           VALUES (?, 1, 'Flight HideNet', ?, 1)`,
          [tid, candidate]
        );
        gid = g.insertId; code = candidate;
      } catch (e) { if (e.code !== 'ER_DUP_ENTRY') throw e; }
    }
    await conn.query(
      `INSERT INTO group_players (group_id, user_id, handicap) VALUES (?, ?, ?)`,
      [gid, playerId, hcInGroup]
    );
    // Grava score no buraco 1 pra ter dado no leaderboard.
    // entity_ref = user_id em individual (namespace positivo).
    await conn.query(
      `INSERT INTO scores (tournament_id, user_id, entity_ref, round_number, hole_number, strokes)
       VALUES (?, ?, ?, 1, 1, 4)`,
      [tid, playerId, playerId]
    );
    return { tid, gid, access_code: code };
  } finally { await conn.end(); }
}

async function cleanup(tid) {
  const conn = await mysql.createConnection(DB_CFG);
  try {
    await conn.execute(`DELETE FROM scores WHERE tournament_id=?`, [tid]);
    await conn.execute(`DELETE FROM group_players WHERE group_id IN (SELECT id FROM tournament_groups WHERE tournament_id=?)`, [tid]);
    await conn.execute(`DELETE FROM tournament_groups WHERE tournament_id=?`, [tid]);
    await conn.execute(`DELETE FROM inscriptions WHERE tournament_id=?`, [tid]);
    await conn.execute(`DELETE FROM tournament_categories WHERE tournament_id=?`, [tid]);
    await conn.execute(`DELETE FROM tournament_rounds WHERE tournament_id=?`, [tid]);
    await conn.execute(`DELETE FROM tournaments WHERE id=?`, [tid]);
  } finally { await conn.end(); }
}

async function loginUI(page, email, pwd) {
  await page.goto('http://localhost:3000/login');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(pwd);
  await page.getByRole('button', { name: /entrar/i }).click();
  await page.waitForURL(u => !String(u).endsWith('/login'), { timeout: 15000 });
}

async function openScorecardDirect(page, groupId, tid, ah) {
  // Injeta activeGroup no localStorage antes de navegar direto pra Scorecard
  await page.evaluate(({ gid, tournId }) => {
    localStorage.setItem('activeGroup', JSON.stringify({
      id: gid, tournament_id: tournId, round_number: 1, savedAt: Date.now(),
    }));
  }, { gid: groupId, tournId: tid });
  await page.goto(`http://localhost:3000/scorecard/${groupId}`);
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2500); // hidratacao (holesData, tourRes...)
}

async function textVisible(page, regex) {
  return page.getByText(regex).first().isVisible().catch(() => false);
}

(async () => {
  console.log('== seed usuario + 2 torneios ==');
  const playerId = await ensureUser(PLAYER_EMAIL, 'Verify HideNet Player', 'M');
  // Baseline (ah=1): handicap 10 no lobby — leaderboard e scorecard exibem HDCP 10.
  const s1 = await seed({ askHandicap: 1, playerId, hcInGroup: 10.0 });
  // Sem HC (ah=0): handicap NULL (jogador nao passou pelo lobby).
  const s0 = await seed({ askHandicap: 0, playerId, hcInGroup: null });
  console.log(`ah=1 tid=${s1.tid} gid=${s1.gid} code=${s1.access_code}`);
  console.log(`ah=0 tid=${s0.tid} gid=${s0.gid} code=${s0.access_code}`);

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await ctx.newPage();
  page.on('dialog', async (d) => { console.log(`[dialog] ${d.message()}`); await d.accept(); });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  const shot = async (label) => {
    const file = path.join(OUT, `verify-ask-handicap-hide-net__${label}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(`screenshot: ${file}`);
  };

  try {
    await loginUI(page, PLAYER_EMAIL, PLAYER_PWD);

    // ===== SCORECARD =====
    // Baseline ah=1 — mostra HDCP e TEE
    console.log('\n== 1. Scorecard ah=1 → mostra HDCP + TEE ==');
    await openScorecardDirect(page, s1.gid, s1.tid, 1);
    await shot('01-scorecard-ah1');
    const hdcpV1 = await textVisible(page, /HDCP\s*10/i);
    const teeV1  = await textVisible(page, /TEE\s+(PRETO|BRANCO|AZUL|VERMELHO|VERDE)/i);
    if (hdcpV1) pass('scorecard ah=1 exibe "HDCP 10"'); else fail('scorecard ah=1 nao exibe HDCP');
    if (teeV1)  pass('scorecard ah=1 exibe TEE ...');   else fail('scorecard ah=1 nao exibe TEE ...');

    // ah=0 — esconde HDCP e TEE
    console.log('\n== 2. Scorecard ah=0 → esconde HDCP + TEE ==');
    await openScorecardDirect(page, s0.gid, s0.tid, 0);
    await shot('02-scorecard-ah0');
    const hdcpV0 = await textVisible(page, /HDCP/i);
    const teeV0  = await textVisible(page, /TEE\s+(PRETO|BRANCO|AZUL|VERMELHO|VERDE)/i);
    if (!hdcpV0) pass('scorecard ah=0 nao exibe HDCP'); else fail('scorecard ah=0 ainda exibe HDCP');
    if (!teeV0)  pass('scorecard ah=0 nao exibe TEE ...'); else fail('scorecard ah=0 ainda exibe TEE ...');

    // ===== LEADERBOARD =====
    // Baseline ah=1: aba Gross (nao Net) → sem (HC XX) mesmo. Precisamos criar
    // um torneio com aba Net pra testar realmente o "(HC XX)". Vamos criar
    // sob demanda um torneio ah=1 com categoria Net.
    // Mas o setup atual so tem Gross. Como aba unica eh Gross, nao aparece
    // (HC XX) mesmo no ah=1. Pra o proposito do commit 2.5, o teste eh: se o
    // admin config ah=0 e uma cat Net por engano, ranking cai em gross e
    // (HC XX) some. Vou criar um s2 (ah=1) e s3 (ah=0) com cat Net M1.

    console.log('\n== 3. Leaderboard: seed 2 torneios adicionais com cat Net ==');
    const conn = await mysql.createConnection(DB_CFG);
    let s1Net = null, s0Net = null;
    try {
      // Copiar seed com cat Net M1 em vez de Gross M0
      // Individual, hcInGroup=10 (ah=1) / null (ah=0)
      const [[course]] = await conn.query('SELECT id FROM courses WHERE club_id=1 LIMIT 1');
      for (const ah of [1, 0]) {
        const label = `NetCat ah${ah}`;
        const name = `Verify HideNet Net ${label} ${Date.now().toString(36).toUpperCase()}`;
        const start = new Date(Date.now() + 26 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
        const [t] = await conn.query(
          `INSERT INTO tournaments (club_id, name, start_date, course_id, format, total_rounds, scoring_type, modality, ask_handicap, status)
           VALUES (1, ?, ?, ?, 'shotgun', 1, 'strokes', 'individual', ?, 'OPEN')`,
          [name, start, course.id, ah]
        );
        const tid = t.insertId;
        await conn.query(
          `INSERT INTO tournament_rounds (tournament_id, round_number, round_date, course_id) VALUES (?, 1, ?, ?)`,
          [tid, start, course.id]
        );
        await conn.query(
          `INSERT INTO tournament_categories (tournament_id, name) VALUES (?, 'Masculino Net (M1) - 0 a 8.5')`,
          [tid]
        );
        const [[cat]] = await conn.query(
          `SELECT id FROM tournament_categories WHERE tournament_id=? LIMIT 1`, [tid]
        );
        await conn.query(
          `INSERT INTO inscriptions (tournament_id, user_id, category_id, status) VALUES (?, ?, ?, 'APPROVED')`,
          [tid, playerId, cat.id]
        );
        let gid = null, code = null;
        for (let i = 0; i < 20 && gid === null; i++) {
          const candidate = randCode();
          try {
            const [g] = await conn.query(
              `INSERT INTO tournament_groups (tournament_id, round_number, group_name, access_code, starting_hole)
               VALUES (?, 1, 'Flight HideNet Net', ?, 1)`,
              [tid, candidate]
            );
            gid = g.insertId; code = candidate;
          } catch (e) { if (e.code !== 'ER_DUP_ENTRY') throw e; }
        }
        // Handicap 5 pra jogador cair na M1 (0..8.5)
        await conn.query(
          `INSERT INTO group_players (group_id, user_id, handicap) VALUES (?, ?, ?)`,
          [gid, playerId, ah === 1 ? 5.0 : null]
        );
        await conn.query(
          `INSERT INTO scores (tournament_id, user_id, entity_ref, round_number, hole_number, strokes) VALUES (?, ?, ?, 1, 1, 4)`,
          [tid, playerId, playerId]
        );
        const seed = { tid, gid, access_code: code };
        if (ah === 1) s1Net = seed; else s0Net = seed;
      }
    } finally { await conn.end(); }
    console.log(`net ah=1 tid=${s1Net.tid}`);
    console.log(`net ah=0 tid=${s0Net.tid}`);

    // ah=1 + cat Net → aba Net renderiza, (HC 5) aparece
    console.log('\n== 4. Leaderboard ah=1 (cat Net M1) → (HC 5) aparece ==');
    await page.goto(`http://localhost:3000/leaderboard/${s1Net.tid}`);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(3000);
    await shot('03-leaderboard-ah1-net');
    const hcV1 = await textVisible(page, /\(HC\s*5\)/);
    if (hcV1) pass('leaderboard ah=1 cat Net exibe "(HC 5)"'); else fail('leaderboard ah=1 nao exibiu "(HC 5)"');

    // ah=0 + cat Net → aba Net renderiza mas (HC XX) NAO aparece (ranking gross)
    console.log('\n== 5. Leaderboard ah=0 (cat Net M1) → sem (HC XX) ==');
    await page.goto(`http://localhost:3000/leaderboard/${s0Net.tid}`);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(3000);
    await shot('04-leaderboard-ah0-net');
    const hcV0 = await textVisible(page, /\(HC\s*/);
    if (!hcV0) pass('leaderboard ah=0 cat Net nao exibe "(HC XX)"'); else fail('leaderboard ah=0 ainda exibe "(HC XX)"');

    // pageerror watchdog
    if (errors.length === 0) pass('nenhum pageerror durante o fluxo');
    else fail(`${errors.length} pageerror(s) — ${errors[0]}`);

    // cleanup extras
    await cleanup(s1Net.tid); await cleanup(s0Net.tid);
  } finally {
    await browser.close();
    console.log('\n== cleanup ==');
    try { await cleanup(s1.tid); console.log(`limpou s1 tid=${s1.tid}`); } catch (e) { console.log(`X limpar s1: ${e.message}`); }
    try { await cleanup(s0.tid); console.log(`limpou s0 tid=${s0.tid}`); } catch (e) { console.log(`X limpar s0: ${e.message}`); }
  }

  console.log('\n== RESULTADO ==');
  console.log(failures === 0 ? 'PASS' : `FAIL (${failures} falhas)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
