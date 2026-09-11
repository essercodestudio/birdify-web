// Verificacao runtime da Fase 2 · Commit 2.4 (ask_handicap no fluxo de entrada).
//
// Escopo: PlayerHome.js (fluxo real do jogador em "/") deve pular o modal
// HANDICAPS quando o torneio tem ask_handicap=0. E preservar comportamento
// historico quando ask_handicap=1.
//
// NOTA: PlayerHome so trata modalidade INDIVIDUAL hoje — o fluxo doubles do
// JoinGame.js (rota legada, code path morto na roteacao atual) nao foi
// migrado na unificacao. Portanto, este verify cobre UI apenas em individual
// e mantem o backend HTTP conferindo os 4 casos (individual/doubles ×
// ask_handicap 0/1) — o backend response ja carrega ask_handicap
// independentemente da modalidade, e o fluxo doubles no PlayerHome fica como
// TODO separado.
//
// Cobre 5 casos com evidencia (screenshots + pageerror watchdog):
//   1. Backend POST /api/groups/join expoe ask_handicap correto nos 4 cenarios
//   2. UI PlayerHome individual + ask_handicap=1 → modal HANDICAPS aparece
//      (regressao — historico preservado)
//   3. UI PlayerHome individual + ask_handicap=0 → SEM modal, navega direto
//      pra /scorecard/:id
//   4. Caminho de volta: o Scorecard renderiza sem pageerror mesmo com
//      p.handicap NULL (calculateTotal tem || 0, calcularPerfilGolfista tem
//      parseFloat|| 0, HDCP {p.handicap ?? 0} — nada explode)
//   5. Persistencia de rotas antigas: mesmo com JoinGame.js sendo codigo
//      legado, o backend response continua sendo consistente pros dois
//      fluxos (mesmo teste do 1 valida)
//
// Requisitos: backend 3001 + frontend CRA 3000 + banco dev com migration 2.1.
//
// Como rodar:
//   cd scripts/verify && node verify-ask-handicap-join.js

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
const PLAYER_EMAIL = 'verify.askhc.player@test.local';
const PLAYER_PWD   = 'verify123';
const P2_EMAIL     = 'verify.askhc.p2@test.local'; // doubles partner
const OUT = __dirname;

let failures = 0;
const fail = (m) => { failures++; console.log('X', m); };
const pass = (m) => console.log('OK', m);

async function ensureUser(email, name, gender, role) {
  const conn = await mysql.createConnection(DB_CFG);
  try {
    const hash = await bcrypt.hash('verify123', 10);
    const [ex] = await conn.execute('SELECT id FROM users WHERE email=?', [email]);
    let id;
    if (ex.length) {
      id = ex[0].id;
      await conn.execute('UPDATE users SET password_hash=?, role=?, name=?, gender=? WHERE id=?',
        [hash, role, name, gender, id]);
    } else {
      const [r] = await conn.execute(
        'INSERT INTO users (name, email, password_hash, role, gender) VALUES (?,?,?,?,?)',
        [name, email, hash, role, gender]
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

// Cria torneio individual OU doubles com ask_handicap explicito + grupo com
// jogador escalado. Devolve { tid, gid, access_code }.
async function seedTournament({ modality, askHandicap, playerId, p2Id }) {
  const conn = await mysql.createConnection({ ...DB_CFG, multipleStatements: true });
  try {
    const [[course]] = await conn.query('SELECT id FROM courses WHERE club_id=1 LIMIT 1');
    if (!course) throw new Error('nenhum course no clube 1');
    const label = `${modality}-ah${askHandicap}`;
    const name = `Verify AskHC ${label} ${Date.now().toString(36).toUpperCase()}`;
    const start = new Date(Date.now() + 26 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    const [t] = await conn.query(
      `INSERT INTO tournaments
         (club_id, name, start_date, course_id, format, total_rounds,
          scoring_type, modality, ask_handicap, status)
       VALUES (1, ?, ?, ?, 'shotgun', 1, 'strokes', ?, ?, 'OPEN')`,
      [name, start, course.id, modality, askHandicap]
    );
    const tid = t.insertId;
    await conn.query(
      `INSERT INTO tournament_rounds (tournament_id, round_number, round_date, course_id)
       VALUES (?, 1, ?, ?)`,
      [tid, start, course.id]
    );

    // Cria grupo com access_code novo (retry contra colisao do UNIQUE)
    let gid = null, code = null;
    for (let i = 0; i < 20 && gid === null; i++) {
      const candidate = randCode();
      try {
        const [g] = await conn.query(
          `INSERT INTO tournament_groups
             (tournament_id, round_number, group_name, access_code, starting_hole)
           VALUES (?, 1, 'Flight Verify', ?, 1)`,
          [tid, candidate]
        );
        gid = g.insertId; code = candidate;
      } catch (e) {
        if (e.code !== 'ER_DUP_ENTRY') throw e;
      }
    }
    if (!gid) throw new Error('nao foi possivel gerar access_code unico');

    if (modality === 'individual') {
      await conn.query(
        `INSERT INTO inscriptions (tournament_id, user_id, status) VALUES (?, ?, 'APPROVED')`,
        [tid, playerId]
      );
      await conn.query(
        `INSERT INTO group_players (group_id, user_id, handicap) VALUES (?, ?, NULL)`,
        [gid, playerId]
      );
    } else {
      // doubles: 2 inscritos + 1 dupla + group_duplas + tournament_dupla_players
      await conn.query(
        `INSERT INTO inscriptions (tournament_id, user_id, status)
         VALUES (?, ?, 'APPROVED'), (?, ?, 'APPROVED')`,
        [tid, playerId, tid, p2Id]
      );
      const [d] = await conn.query(
        `INSERT INTO tournament_duplas (tournament_id, dupla_name, handicap)
         VALUES (?, ?, NULL)`,
        [tid, `Dupla Verify ${label}`]
      );
      const did = d.insertId;
      await conn.query(
        `INSERT INTO tournament_dupla_players (dupla_id, user_id)
         VALUES (?, ?), (?, ?)`,
        [did, playerId, did, p2Id]
      );
      await conn.query(
        `INSERT INTO group_duplas (group_id, dupla_id, handicap) VALUES (?, ?, NULL)`,
        [gid, did]
      );
    }
    return { tid, gid, access_code: code };
  } finally { await conn.end(); }
}

async function cleanupTournament(tid) {
  const conn = await mysql.createConnection(DB_CFG);
  try {
    await conn.execute(`DELETE FROM tournament_scorecard_signatures WHERE tournament_id=?`, [tid]);
    await conn.execute(`DELETE FROM group_duplas WHERE group_id IN (SELECT id FROM tournament_groups WHERE tournament_id=?)`, [tid]);
    await conn.execute(`DELETE FROM group_players WHERE group_id IN (SELECT id FROM tournament_groups WHERE tournament_id=?)`, [tid]);
    await conn.execute(`DELETE FROM tournament_groups WHERE tournament_id=?`, [tid]);
    await conn.execute(`DELETE FROM tournament_dupla_players WHERE dupla_id IN (SELECT id FROM tournament_duplas WHERE tournament_id=?)`, [tid]);
    await conn.execute(`DELETE FROM tournament_duplas WHERE tournament_id=?`, [tid]);
    await conn.execute(`DELETE FROM inscriptions WHERE tournament_id=?`, [tid]);
    await conn.execute(`DELETE FROM tournament_rounds WHERE tournament_id=?`, [tid]);
    await conn.execute(`DELETE FROM tournaments WHERE id=?`, [tid]);
  } finally { await conn.end(); }
}

function apiCall(method, apiPath, token, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'localhost', port: 3001, path: apiPath, method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Host: 'localhost',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const r = http.request(opts, (res) => {
      let chunks = '';
      res.on('data', c => chunks += c);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(chunks || '{}'); } catch { parsed = chunks; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function loginUI(page, email, pwd) {
  await page.goto('http://localhost:3000/login');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(pwd);
  await page.getByRole('button', { name: /entrar/i }).click();
  await page.waitForURL(url => !String(url).endsWith('/login'), { timeout: 15000 });
}

// PlayerHome ("/") tem o quick-action "Entrar na Partida" que abre o modal
// com o input de codigo. Precisa navegar pra "/", clicar no atalho e so
// entao digitar o codigo.
async function openJoinModal(page) {
  await page.goto('http://localhost:3000/');
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  // Aceita cookies se aparecerem
  await page.getByRole('button', { name: /Entendido e Aceito/i }).click().catch(() => {});
  await page.getByText(/Entrar na Partida/i).first().click();
  await page.waitForSelector('input[placeholder="A1B2"]', { timeout: 5000 });
}

async function submitJoinCode(page, code) {
  await openJoinModal(page);
  const input = page.locator('input[placeholder="A1B2"]');
  await input.fill(code);
  await page.getByRole('button', { name: /COMEÇAR PARTIDA/i }).click();
}

// Retorna true se o modal de handicaps esta visivel (via h2 "HANDICAPS").
async function isHandicapModalOpen(page) {
  return page.getByRole('heading', { name: /^HANDICAPS$/ }).isVisible().catch(() => false);
}

(async () => {
  console.log('== seed usuarios + 4 torneios ==');
  const playerId = await ensureUser(PLAYER_EMAIL, 'Verify AskHC Player', 'M', 'PLAYER');
  const p2Id     = await ensureUser(P2_EMAIL,     'Verify AskHC Partner', 'M', 'PLAYER');

  // 4 combinacoes: individual/doubles x ask_handicap 1/0
  const t_ind_on  = await seedTournament({ modality: 'individual', askHandicap: 1, playerId, p2Id });
  const t_ind_off = await seedTournament({ modality: 'individual', askHandicap: 0, playerId, p2Id });
  const t_dbl_on  = await seedTournament({ modality: 'doubles',    askHandicap: 1, playerId, p2Id });
  const t_dbl_off = await seedTournament({ modality: 'doubles',    askHandicap: 0, playerId, p2Id });
  console.log(`individual ah=1 tid=${t_ind_on.tid}  code=${t_ind_on.access_code}`);
  console.log(`individual ah=0 tid=${t_ind_off.tid} code=${t_ind_off.access_code}`);
  console.log(`doubles    ah=1 tid=${t_dbl_on.tid}  code=${t_dbl_on.access_code}`);
  console.log(`doubles    ah=0 tid=${t_dbl_off.tid} code=${t_dbl_off.access_code}`);

  const PLAYER_TOKEN = jwt.sign({ id: playerId, role: 'PLAYER' }, process.env.JWT_SECRET, { expiresIn: '1h' });

  try {
    // ===== PARTE 1: BACKEND HTTP =====
    console.log('\n== 1. backend POST /api/groups/join expoe ask_handicap ==');
    const bkCases = [
      { t: t_ind_on,  expected: 1 },
      { t: t_ind_off, expected: 0 },
      { t: t_dbl_on,  expected: 1 },
      { t: t_dbl_off, expected: 0 },
    ];
    for (const { t, expected } of bkCases) {
      const res = await apiCall('POST', '/api/groups/join', PLAYER_TOKEN, { access_code: t.access_code });
      if (res.status !== 200) {
        fail(`join tid=${t.tid}: status ${res.status} ${JSON.stringify(res.body)}`);
        continue;
      }
      const ah = res.body?.group?.ask_handicap;
      if (Number(ah) !== expected) {
        fail(`join tid=${t.tid} esperado ask_handicap=${expected}, veio ${ah}`);
      } else {
        pass(`join tid=${t.tid} → response.group.ask_handicap=${ah}`);
      }
    }

    // ===== PARTE 2: UI PLAYWRIGHT =====
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
    const page = await ctx.newPage();
    // Catch de dialogs (alerts do JoinGame quando algo falha)
    page.on('dialog', async (d) => { console.log(`[dialog] ${d.message()}`); await d.accept(); });
    // Watchdog de crash: qualquer erro JS on page derruba o verify
    const pageErrors = [];
    page.on('pageerror', (e) => { pageErrors.push(String(e)); });

    const shot = async (label) => {
      const file = path.join(OUT, `verify-ask-handicap-join__${label}.png`);
      await page.screenshot({ path: file, fullPage: true });
      console.log(`screenshot: ${file}`);
    };

    try {
      await loginUI(page, PLAYER_EMAIL, PLAYER_PWD);

      // -------- 2. UI PlayerHome individual + ask_handicap=1 (regressao) --------
      console.log('\n== 2. UI PlayerHome individual ask_handicap=1 → modal HANDICAPS aparece ==');
      await submitJoinCode(page, t_ind_on.access_code);
      await page.waitForTimeout(1500);
      await shot('01-individual-ah1-modal');
      if (await isHandicapModalOpen(page)) {
        pass('individual ah=1 → modal HANDICAPS visivel (regressao OK)');
      } else {
        fail('individual ah=1 → modal HANDICAPS NAO apareceu (regressao quebrou)');
      }

      // -------- 3. UI PlayerHome individual + ask_handicap=0 (skip + volta) --------
      console.log('\n== 3. UI PlayerHome individual ask_handicap=0 → SEM modal, direto pro Scorecard ==');
      await submitJoinCode(page, t_ind_off.access_code);
      // Espera navegacao pra /scorecard/:id (o skip navega direto)
      await page.waitForURL(u => /\/scorecard\/\d+/.test(String(u)), { timeout: 15000 })
        .catch(() => {});
      await page.waitForTimeout(2500);
      await shot('02-individual-ah0-scorecard');
      if (await isHandicapModalOpen(page)) {
        fail('individual ah=0 → modal HANDICAPS apareceu (deveria pular)');
      } else {
        pass('individual ah=0 → modal HANDICAPS nao aparece');
      }
      const urlAfter = page.url();
      if (/\/scorecard\/\d+/.test(urlAfter)) {
        pass(`individual ah=0 → navegou pra ${urlAfter}`);
      } else {
        fail(`individual ah=0 → nao navegou pra scorecard (url=${urlAfter})`);
      }
      // -------- 4. Caminho de volta: Scorecard sem crash com handicap NULL --------
      // group_players.handicap ficou NULL no seed (ask_handicap=0 → jogador
      // nao passou pelo lobby). calculateTotal (parseFloat(x||0)),
      // calcularPerfilGolfista (parseFloat(x)||0) e HDCP {p.handicap ?? 0}
      // tem fallback — pageerror pega se algo extra rebentar.
      console.log('\n== 4. caminho de volta: Scorecard renderiza sem pageerror ==');
      if (pageErrors.length === 0) {
        pass('Scorecard renderizou sem pageerror mesmo com handicap NULL');
      } else {
        fail(`${pageErrors.length} pageerror(s) — ${pageErrors[0]}`);
      }

      // -------- 5. Confirma que fluxo doubles NAO passa por PlayerHome hoje --------
      // Documenta comportamento pre-existente do PlayerHome (TODO separado
      // para migrar doubles). Aqui so provamos que o backend continua
      // consistente pros 4 casos (checado na parte 1); nao dirijimos UI de
      // doubles porque nao ha fluxo UI de doubles em PlayerHome.
      console.log('\n== 5. doubles em PlayerHome fica como TODO (backend ja consistente) ==');
      pass('backend expoe ask_handicap em doubles (validado na parte 1) — fluxo UI doubles em PlayerHome nao existe hoje');
    } finally {
      await browser.close();
    }
  } finally {
    console.log('\n== cleanup ==');
    for (const t of [t_ind_on, t_ind_off, t_dbl_on, t_dbl_off]) {
      try { await cleanupTournament(t.tid); console.log(`limpou tid=${t.tid}`); }
      catch (e) { console.log(`X limpar tid=${t.tid}: ${e.message}`); }
    }
  }

  console.log('\n== RESULTADO ==');
  console.log(failures === 0 ? 'PASS' : `FAIL (${failures} falhas)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
