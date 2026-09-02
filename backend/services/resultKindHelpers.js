// backend/services/resultKindHelpers.js
//
// Helpers compartilhados pra Pontuação por Resultado (Onda A · 2026-08-31).
// Usados por scoreController e adminScoreController pra manter a MESMA regra de
// derivação nos dois pontos de escrita — evita divergência que apareceria só em
// bug de produção.

const RESULT_KINDS = ['hio', 'albatross', 'eagle', 'birdie', 'par', 'bogey', 'double_bogey', 'triple_bogey'];

// Deriva tacadas ficta a partir do resultado nominal + par do buraco.
// Retorna { strokes } em sucesso, { error } em falha.
//
// Regras:
//   - HiO: sempre 1 (independente do par). Em par 4, HiO tem os mesmos strokes
//     que Albatross (=1) mas SEMANTICAMENTE são resultados nominais diferentes
//     — por isso result_kind é gravado separado, é a fonte da verdade nominal.
//   - Albatross: par-3. Impossível em par 3 (daria 0), rejeita.
//   - Eagle: par-2. Impossível em par 2 (mas par golfe é 3+, então na prática
//     ok — só valida se par-2 >= 1 defensivamente).
//   - Birdie/Par/Bogey/DoubleBogey/TripleBogey: par ± N. Sempre válido pra par >= 3.
function deriveStrokesFromResult(par, resultKind) {
  const p = Number(par);
  if (!Number.isInteger(p) || p < 3) {
    return { error: `par inválido para derivação: ${par} (esperado inteiro >= 3).` };
  }
  switch (resultKind) {
    case 'hio': return { strokes: 1 };
    case 'albatross': {
      const s = p - 3;
      if (s < 1) return { error: `Albatross impossível em par ${p}.` };
      return { strokes: s };
    }
    case 'eagle': {
      const s = p - 2;
      if (s < 1) return { error: `Eagle impossível em par ${p}.` };
      return { strokes: s };
    }
    case 'birdie':       return { strokes: p - 1 };
    case 'par':          return { strokes: p };
    case 'bogey':        return { strokes: p + 1 };
    case 'double_bogey': return { strokes: p + 2 };
    case 'triple_bogey': return { strokes: p + 3 };
    default:
      return { error: `result_kind inválido: '${resultKind}'. Aceitos: ${RESULT_KINDS.join(', ')}.` };
  }
}

// Bloco 2 · Commit 2.2 (2026-09-01): retorna Set com os result_kinds ATIVOS
// (enabled=1) no torneio. Usado por scoreController e adminScoreController pra
// rejeitar escritas de kinds desativados pelo admin.
//
// Torneio strokes ou sem config: retorna Set vazio (leitor deve tratar como
// "não aplicável" — nenhum kind é aceito porque o modo não usa result_kind).
//
// Cache OFF de propósito: config muda raramente mas quando muda precisa refletir
// imediato. Cada save carrega uma consulta indexada por PK composta — barato.
async function getEnabledKinds(db, tournamentId) {
  const [rows] = await db.execute(
    `SELECT result_kind FROM tournament_result_points
      WHERE tournament_id = ? AND enabled = 1`,
    [tournamentId]
  );
  return new Set(rows.map(r => r.result_kind));
}

// Busca o par de um buraco específico no course da rodada, com fallback pro
// course do próprio torneio (single-round legado) e default 4. Espelha o COALESCE
// que o leaderboardController usa, mas em query dedicada e única linha —
// otimizado pro caller que só precisa de UM par de cada vez.
async function fetchPar(db, tournamentId, roundNumber, holeNumber) {
  const [rows] = await db.execute(
    `SELECT COALESCE(h.par, ch.par, hf.par, chf.par, 4) AS par
       FROM tournaments t
       LEFT JOIN tournament_rounds tr
         ON tr.tournament_id = t.id AND tr.round_number = ?
       LEFT JOIN holes        h  ON h.course_id  = tr.course_id AND h.hole_number  = ?
       LEFT JOIN course_holes ch ON ch.course_id = tr.course_id AND ch.hole_number = ?
       LEFT JOIN holes        hf ON hf.course_id = t.course_id  AND hf.hole_number = ?
       LEFT JOIN course_holes chf ON chf.course_id = t.course_id AND chf.hole_number = ?
      WHERE t.id = ?
      LIMIT 1`,
    [roundNumber, holeNumber, holeNumber, holeNumber, holeNumber, tournamentId]
  );
  return rows.length ? Number(rows[0].par) : 4;
}

module.exports = {
  RESULT_KINDS,
  deriveStrokesFromResult,
  fetchPar,
  getEnabledKinds,
};
