// backend/services/whsService.js
// World Handicap System — cálculo do Handicap Index
// Referência: https://www.usga.org/handicapping/roh/Content/rules/
//
// Este módulo contém APENAS funções puras (sem I/O). O caller (controller)
// carrega os dados do banco e alimenta as funções.

// Máximos WHS
const MAX_HANDICAP_MEN   = 54.0;
const MAX_HANDICAP_WOMEN = 54.0; // pós-2020 unificou em 54.0 pra ambos

// ─────────────────────────────────────────────────────────────────────
// Course Handicap = HI × (Slope / 113) + (CR - Par)
// Arredondado ao inteiro mais próximo.
// ─────────────────────────────────────────────────────────────────────
function courseHandicap(handicapIndex, slopeRating, courseRating, coursePar) {
  if (handicapIndex == null) return null;
  const raw = handicapIndex * (slopeRating / 113) + (courseRating - coursePar);
  return Math.round(raw);
}

// ─────────────────────────────────────────────────────────────────────
// Strokes recebidos em um buraco específico (para Net Double Bogey)
// Distribui o Course Handicap pelos buracos em ordem de handicap index.
// Como o Birdify não tem "Stroke Index" por buraco cadastrado, usamos
// uma distribuição uniforme: N strokes / 18 buracos, resto do 1º ao (resto)º.
// ─────────────────────────────────────────────────────────────────────
function strokesReceivedAtHole(courseHandicap, holeIndex /* 1..18 */, totalHoles = 18) {
  if (courseHandicap == null || courseHandicap <= 0) return 0;
  const base = Math.floor(courseHandicap / totalHoles);
  const rem  = courseHandicap % totalHoles;
  return base + (holeIndex <= rem ? 1 : 0);
}

// ─────────────────────────────────────────────────────────────────────
// Net Double Bogey de UM buraco = Par + 2 + strokes recebidos naquele buraco
// Se o jogador ainda não tem HI (courseHandicap null), usar cap fixo Par + 5.
// ─────────────────────────────────────────────────────────────────────
function netDoubleBogey(par, courseHandicap, holeIndex) {
  if (courseHandicap == null) return par + 5;
  return par + 2 + strokesReceivedAtHole(courseHandicap, holeIndex);
}

// ─────────────────────────────────────────────────────────────────────
// Adjusted Gross Score — aplica Net Double Bogey a cada buraco jogado.
// scoresByHole: array de 18 objetos { hole_number, strokes, par }
// courseHandicap: CH do jogador nesse campo/tee (ou null se ainda não tem HI)
// ─────────────────────────────────────────────────────────────────────
function adjustedGrossScore(scoresByHole, courseHandicap) {
  let adjusted = 0;
  for (const s of scoresByHole) {
    const cap = netDoubleBogey(s.par, courseHandicap, s.hole_number);
    adjusted += Math.min(s.strokes, cap);
  }
  return adjusted;
}

// ─────────────────────────────────────────────────────────────────────
// Score Differential = (113 / SR) × (AGS - CR - PCC)
// PCC padrão 0 (não implementamos cálculo diário aqui).
// Retorna com 1 casa decimal.
// ─────────────────────────────────────────────────────────────────────
function scoreDifferential(adjustedGross, courseRating, slopeRating, pcc = 0) {
  const raw = (113 / slopeRating) * (adjustedGross - courseRating - pcc);
  return Math.round(raw * 10) / 10;
}

// ─────────────────────────────────────────────────────────────────────
// Handicap Index a partir dos differentials.
// Regra WHS: usa os últimos 20 scores; pega os melhores (mais baixos)
// segundo a tabela oficial:
//    scores=3   → best - 2.0
//    scores=4   → best - 1.0
//    scores=5   → best
//    scores=6   → média dos 2 melhores - 1.0
//    scores=7-8 → média dos 2 melhores
//    scores=9-11 → média dos 3 melhores
//    scores=12-14 → média dos 4 melhores
//    scores=15-16 → média dos 5 melhores
//    scores=17-18 → média dos 6 melhores
//    scores=19  → média dos 7 melhores
//    scores=20+ → média dos 8 melhores
// Menos de 3 scores → null (sem HI).
// ─────────────────────────────────────────────────────────────────────
function handicapIndexFromDiffs(diffsMostRecentFirst, gender = "M") {
  const last20 = diffsMostRecentFirst.slice(0, 20);
  const n = last20.length;
  if (n < 3) return null;

  const sorted = [...last20].sort((a, b) => a - b);

  let hi;
  if (n === 3) hi = sorted[0] - 2.0;
  else if (n === 4) hi = sorted[0] - 1.0;
  else if (n === 5) hi = sorted[0];
  else if (n === 6) hi = avg(sorted, 2) - 1.0;
  else if (n <= 8)  hi = avg(sorted, 2);
  else if (n <= 11) hi = avg(sorted, 3);
  else if (n <= 14) hi = avg(sorted, 4);
  else if (n <= 16) hi = avg(sorted, 5);
  else if (n <= 18) hi = avg(sorted, 6);
  else if (n === 19) hi = avg(sorted, 7);
  else hi = avg(sorted, 8);

  const max = gender === "F" ? MAX_HANDICAP_WOMEN : MAX_HANDICAP_MEN;
  if (hi > max) hi = max;

  // Arredondamento a 1 decimal
  return Math.round(hi * 10) / 10;
}

function avg(arr, count) {
  const slice = arr.slice(0, count);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / slice.length;
}

// ─────────────────────────────────────────────────────────────────────
// Aplica Soft Cap / Hard Cap comparando o HI proposto com o Low HI
// (menor HI nos últimos 365 dias).
//
// Regra oficial WHS:
//   Se novoHI - lowHI <= 3.0 → sem alteração
//   Se novoHI - lowHI > 3.0 → soft cap: aumento acima de 3.0 é reduzido 50%
//   Hard cap: aumento total nunca pode exceder 5.0
// ─────────────────────────────────────────────────────────────────────
function applySoftHardCap(newHi, lowHi) {
  if (newHi == null || lowHi == null) return newHi;
  const diff = newHi - lowHi;
  if (diff <= 3.0) return newHi;

  // Soft cap: metade do excesso acima de 3.0
  let capped = lowHi + 3.0 + (diff - 3.0) * 0.5;

  // Hard cap: máximo lowHi + 5.0
  if (capped > lowHi + 5.0) capped = lowHi + 5.0;

  return Math.round(capped * 10) / 10;
}

// ─────────────────────────────────────────────────────────────────────
// Given uma lista de rodadas (mais recente primeiro) e o Low HI,
// retorna { handicap_index, low_handicap_index, rounds_count }.
// rounds: [{ round_date, differential }, ...]
// ─────────────────────────────────────────────────────────────────────
function calculateHandicapProfile(rounds, gender = "M") {
  const diffs = rounds.map((r) => Number(r.differential));
  const preliminaryHi = handicapIndexFromDiffs(diffs, gender);

  // Low HI = menor HI nos últimos 365 dias.
  // Como nosso "HI ao longo do tempo" viria de rounds.handicap_at_round,
  // usamos o mínimo dos differentials como aproximação nesse subconjunto.
  const now = Date.now();
  const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000;
  const recent = rounds.filter((r) => new Date(r.round_date).getTime() >= oneYearAgo);

  // Aproximação: entre HIs históricos que já calculamos (handicap_at_round).
  // Se ainda não temos histórico, o Low HI = preliminaryHi.
  const historicalHis = recent
    .map((r) => (r.handicap_at_round == null ? null : Number(r.handicap_at_round)))
    .filter((v) => v != null);
  const lowHi = historicalHis.length > 0
    ? Math.min(...historicalHis, preliminaryHi ?? Infinity)
    : preliminaryHi;

  const finalHi = applySoftHardCap(preliminaryHi, lowHi);

  return {
    handicap_index: finalHi,
    low_handicap_index: lowHi,
    rounds_count: rounds.length,
  };
}

module.exports = {
  courseHandicap,
  strokesReceivedAtHole,
  netDoubleBogey,
  adjustedGrossScore,
  scoreDifferential,
  handicapIndexFromDiffs,
  applySoftHardCap,
  calculateHandicapProfile,
  MAX_HANDICAP_MEN,
  MAX_HANDICAP_WOMEN,
};
