// Verificação runtime do Bug A (torneio): perda de scores offline no scorecard
// de torneio. Fluxo espelha o do treino mas com tournaments/tournament_groups/
// group_players/scores. Setup do torneio é feito direto no banco pra evitar
// dependência do fluxo admin.
//
// Como rodar: veja bug_a_treino.js (mesma stack de pré-requisitos).

const path = require('path');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: path.join(__dirname, '..', '..', 'backend', '.env') });

const { chromium } = require('playwright-core');
const mysql = require('mysql2/promise');

const BACKEND = process.env.VERIFY_BACKEND || 'http://localhost:3001';
const FRONTEND = process.env.VERIFY_FRONTEND || 'http://localhost:3000';
const DB_CFG = {
  host: process.env.DB_HOST, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
};

const CREATOR_EMAIL = 'verify.creator@test.local';
const ATHLETE2_EMAIL = 'verify.athlete2@test.local';
const PASSWORD = 'birdify123';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function query(sql, params = []) {
  const conn = await mysql.createConnection(DB_CFG);
  const [rows] = await conn.execute(sql, params);
  await conn.end();
  return rows;
}

async function ensureTestUsers() {
  const conn = await mysql.createConnection(DB_CFG);
  try {
    const hash = await bcrypt.hash(PASSWORD, 10);
    for (const [name, email] of [
      ['Verify Criador', CREATOR_EMAIL],
      ['Verify Atleta2', ATHLETE2_EMAIL],
    ]) {
      await conn.execute(
        `INSERT INTO users (name, email, password_hash, gender, role)
         VALUES (?, ?, ?, 'M', 'PLAYER')
         ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash), name=VALUES(name)`,
        [name, email, hash],
      );
    }
  } finally { await conn.end(); }
}

const tokenCache = new Map();
async function loginAndGetToken(email) {
  if (tokenCache.has(email)) return tokenCache.get(email);
  let res = await fetch(`${BACKEND}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (res.status === 401 || res.status === 404) {
    await ensureTestUsers();
    res = await fetch(`${BACKEND}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
  }
  const j = await res.json();
  if (!res.ok) throw new Error(`Login ${email}: ${JSON.stringify(j)}`);
  const cached = { token: j.token, user: j.user };
  tokenCache.set(email, cached);
  return cached;
}

let torneioSeq = 0;
async function bootstrapTournament() {
  const creator = await loginAndGetToken(CREATOR_EMAIL);
  const athlete2 = await loginAndGetToken(ATHLETE2_EMAIL);

  // Setup direto no banco: mais simples que passar pelo fluxo admin.
  const code = `VRF${Date.now().toString().slice(-5)}${++torneioSeq}`;
  const conn = await mysql.createConnection(DB_CFG);
  try {
    const [t] = await conn.execute(
      `INSERT INTO tournaments (club_id, name, start_date, course_id, status, format)
       VALUES (1, ?, CURDATE(), 10, 'OPEN', 'shotgun')`,
      [`Verify Torneio ${code}`]
    );
    const tournamentId = t.insertId;
    const [g] = await conn.execute(
      `INSERT INTO tournament_groups (tournament_id, group_name, access_code, starting_hole)
       VALUES (?, ?, ?, 1)`,
      [tournamentId, `Flight ${code}`, code]
    );
    const groupId = g.insertId;
    await conn.execute(
      `INSERT INTO group_players (group_id, user_id, handicap) VALUES (?, ?, 10)`,
      [groupId, creator.user.id]
    );
    await conn.execute(
      `INSERT INTO group_players (group_id, user_id, handicap) VALUES (?, ?, 15)`,
      [groupId, athlete2.user.id]
    );
    return { tournamentId, groupId, accessCode: code, creator, athlete2 };
  } finally { await conn.end(); }
}

async function launchAsCreator(browser, ctx) {
  const context = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await context.newPage();
  page.on('dialog', async d => {
    console.log('  [dialog]', d.type(), d.message());
    await d.accept();
  });

  await page.goto(`${FRONTEND}/login`);
  // Seed token + activeGroup (o Scorecard exige activeGroup no localStorage)
  await page.evaluate(({ token, user, group }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('activeGroup', JSON.stringify(group));
  }, {
    token: ctx.creator.token, user: ctx.creator.user,
    group: {
      id: ctx.groupId,
      tournament_id: ctx.tournamentId,
      tournament_name: 'Verify Torneio',
      group_name: 'Flight Verify',
      starting_hole: 1,
      course_id: 10,
    },
  });
  await page.goto(`${FRONTEND}/scorecard/${ctx.groupId}`);
  await page.waitForSelector('text=Buraco', { timeout: 15000 });
  await sleep(500);
  return { context, page };
}

async function markHole(page, holeExpected) {
  await page.waitForSelector(`text=Buraco ${holeExpected}`, { timeout: 10000 });
  await sleep(200);
  const plusButtons = await page.locator('button:has-text("+")').all();
  if (plusButtons.length < 2) {
    throw new Error(`Esperava 2 botões + no buraco ${holeExpected}, achei ${plusButtons.length}`);
  }
  await plusButtons[0].click();
  await plusButtons[1].click();
  await sleep(50);
}

async function advanceHole(page) {
  await page.locator('button:has-text("▶")').click();
  await sleep(150);
}

const cdpByPage = new WeakMap();
async function getCdp(page) {
  let client = cdpByPage.get(page);
  if (!client) {
    client = await page.context().newCDPSession(page);
    await client.send('Network.enable');
    cdpByPage.set(page, client);
  }
  return client;
}
async function setOffline(page, on) {
  const client = await getCdp(page);
  await client.send('Network.emulateNetworkConditions', {
    offline: on, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
  });
}

async function scoresInDb(tournamentId) {
  return await query(
    `SELECT hole_number, user_id, strokes FROM scores
     WHERE tournament_id=? AND hole_number BETWEEN 1 AND 6 ORDER BY hole_number, user_id`,
    [tournamentId]
  );
}

function fmt(rows) {
  return rows.map(r => `H${r.hole_number}/U${r.user_id}=${r.strokes}`).join(' ');
}

function assertComplete1to6(rows, creatorId, athlete2Id, label) {
  const missing = [];
  for (let h = 1; h <= 6; h++) {
    if (!rows.some(r => r.hole_number === h && r.user_id === creatorId)) missing.push(`H${h}/creator`);
    if (!rows.some(r => r.hole_number === h && r.user_id === athlete2Id)) missing.push(`H${h}/athlete2`);
  }
  if (missing.length) {
    console.log(`  ❌ ${label}: buracos faltando → ${missing.join(', ')}`);
    return false;
  }
  console.log(`  ✅ ${label}: 12 scores → ${fmt(rows)}`);
  return true;
}

async function scenarioA(browser) {
  console.log('\n=== Torneio Cenário A: marcar no buraco atual offline, sem clicar ▶ ===');
  // O cenário CRÍTICO específico do torneio: antes do fix, o enqueue só rolava
  // ao clicar ▶ pra avançar. Marcações no buraco atual não entravam na fila,
  // só no draft local. Se o usuário caísse offline no buraco X e não avançasse,
  // ao voltar online o dado ficava no draft mas nunca ia pra fila.
  const ctx = await bootstrapTournament();
  const { context, page } = await launchAsCreator(browser, ctx);
  try {
    // Marca 1-2 online e avança (baseline conhecido)
    for (let h = 1; h <= 2; h++) { await markHole(page, h); await advanceHole(page); }
    await sleep(700);
    // Vai offline
    await setOffline(page, true);
    console.log('  [offline]');
    // Marca 3 no buraco atual mas NÃO avança
    await markHole(page, 3);
    await sleep(700);
    // Confirma que a fila tem os itens do buraco 3 (fix do Bloco 2)
    const queueLen = await page.evaluate(() => {
      const q = JSON.parse(localStorage.getItem('birdify_sync_queue') || '[]');
      return q.filter(i => i.endpoint === '/scores/save' && (i.status === 'pendente' || i.status === 'falhou')).length;
    });
    console.log(`  itens PENDENTES na fila no buraco atual (sem avançar): ${queueLen}`);
    if (queueLen < 2) {
      console.log('  ❌ Regressão: o buraco atual não foi enfileirado. Fix do Bloco 2 quebrou.');
      return false;
    }
    // Volta online
    await setOffline(page, false);
    await sleep(3500);
    const rows = await query(
      `SELECT hole_number, user_id, strokes FROM scores
       WHERE tournament_id=? AND hole_number=3 ORDER BY user_id`,
      [ctx.tournamentId]
    );
    if (rows.length !== 2) {
      console.log(`  ❌ Cenário A: buraco 3 devia ter 2 scores, tem ${rows.length}`);
      return false;
    }
    console.log(`  ✅ Cenário A: buraco 3 recebido → ${fmt(rows)}`);
    return true;
  } finally { await context.close(); }
}

async function scenarioB(browser) {
  console.log('\n=== Torneio Cenário B: marcar 1-6 com queda no meio, tudo confirmado ===');
  const ctx = await bootstrapTournament();
  const { context, page } = await launchAsCreator(browser, ctx);
  try {
    for (let h = 1; h <= 3; h++) { await markHole(page, h); await advanceHole(page); }
    await sleep(700);
    await setOffline(page, true);
    console.log('  [offline]');
    for (let h = 4; h <= 6; h++) { await markHole(page, h); await advanceHole(page); }
    await sleep(700);
    const pillText = await page.locator('text=/Aguardando|Sincroniz/').first().textContent().catch(() => '(sem pill)');
    console.log(`  pill offline: "${pillText}"`);
    await setOffline(page, false);
    console.log('  [online]');
    await sleep(3500);
    const rows = await scoresInDb(ctx.tournamentId);
    return assertComplete1to6(rows, ctx.creator.user.id, ctx.athlete2.user.id, 'Cenário B');
  } finally { await context.close(); }
}

async function scenarioC(browser) {
  console.log('\n=== Torneio Cenário C: fechar browser offline, reabrir online ===');
  const ctx = await bootstrapTournament();
  const first = await launchAsCreator(browser, ctx);
  let storageState;
  try {
    for (let h = 1; h <= 3; h++) { await markHole(first.page, h); await advanceHole(first.page); }
    await sleep(700);
    await setOffline(first.page, true);
    console.log('  [offline]');
    for (let h = 4; h <= 6; h++) { await markHole(first.page, h); await advanceHole(first.page); }
    await sleep(700);
    storageState = await first.context.storageState();
    const qCount = JSON.parse(storageState.origins[0].localStorage.find(s => s.name === 'birdify_sync_queue')?.value || '[]').length;
    console.log(`  itens na fila antes de fechar: ${qCount}`);
  } finally {
    await first.context.close();
    console.log('  [browser fechado]');
  }
  const context = await browser.newContext({ viewport: { width: 420, height: 900 }, storageState });
  const page = await context.newPage();
  page.on('dialog', async d => await d.accept());
  await page.goto(`${FRONTEND}/scorecard/${ctx.groupId}`);
  await page.waitForSelector('text=Buraco', { timeout: 15000 });
  console.log('  [reaberto — bootstrap flush automático]');
  await sleep(4000);
  const rows = await scoresInDb(ctx.tournamentId);
  const ok = assertComplete1to6(rows, ctx.creator.user.id, ctx.athlete2.user.id, 'Cenário C');
  await context.close();
  return ok;
}

async function scenarioD(browser) {
  console.log('\n=== Torneio Cenário D: bloqueio de "Assinar Cartão" com pendência ===');
  const ctx = await bootstrapTournament();
  const { context, page } = await launchAsCreator(browser, ctx);
  try {
    for (let h = 1; h <= 3; h++) { await markHole(page, h); await advanceHole(page); }
    await sleep(700);
    await setOffline(page, true);
    for (let h = 4; h <= 5; h++) { await markHole(page, h); await advanceHole(page); }
    await sleep(700);
    // Torneio: no modo review, aparece botão "Finalizar Cartão" que abre o summary.
    // Não estamos em review, então vou navegar até chegar em playedHoles.length >= 18
    // pra abrir o summary automaticamente? Não — muito trabalho. Vou usar o botão
    // Voltar e Editar → Finalizar Cartão? Não existe. O summary é auto quando
    // playedHoles>=18. Alternativa: forçar showSummary via evaluate.
    console.log('  [forçando showSummary via evaluate — testa apenas o guard]');
    // Não dá pra forçar setShowSummary de fora facilmente. Vou marcar até 18 buracos.
    // Mais fácil: vou avançar até playedHoles.length >= 18 sem marcar novos.
    // Mas o guard "falta anotar score" impediria... Vou marcar do 6 ao 18 offline mesmo.
    for (let h = 6; h <= 18; h++) { await markHole(page, h); await advanceHole(page); }
    await sleep(700);
    // Agora playedHoles >= 18, summary deve estar visível
    await page.waitForSelector('text=Conferência Final', { timeout: 5000 }).catch(() => {});
    // Se ainda não abriu, clica em ▶ mais uma vez
    if (!(await page.locator('text=Assinar Cartão').count())) {
      await page.locator('button:has-text("▶")').click().catch(() => {});
      await sleep(500);
    }
    const confirmBtn = page.locator('button:has-text("Assinar Cartão")').first();
    const isDisabled = await confirmBtn.isDisabled().catch(() => null);
    console.log(`  botão "Assinar Cartão" isDisabled (offline)=${isDisabled}`);
    const warning = await page.locator('text=/sincroniz|sem envio|aguarde/i').first().textContent().catch(() => null);
    console.log(`  aviso pending: "${warning}"`);
    await setOffline(page, false);
    await sleep(4000);
    const isDisabledAfter = await confirmBtn.isDisabled().catch(() => null);
    console.log(`  após online, isDisabled=${isDisabledAfter}`);
    const passed = isDisabled === true && isDisabledAfter === false;
    console.log(`  ${passed ? '✅' : '❌'} Cenário D: bloqueou offline (${isDisabled}) e liberou online (${!isDisabledAfter})`);
    return passed;
  } finally { await context.close(); }
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const results = {};
  try {
    results.A = await scenarioA(browser);
    results.B = await scenarioB(browser);
    results.C = await scenarioC(browser);
    results.D = await scenarioD(browser);
  } catch (e) {
    console.error('ERRO:', e);
    results.error = e.message;
  } finally {
    await browser.close();
  }
  console.log('\n=== RESULTADO ===');
  console.log(JSON.stringify(results, null, 2));
  process.exit(Object.values(results).every(v => v === true) ? 0 : 1);
})();
