const db = require("../db");

const clubId = (req) => req.club?.id || 1;

const VALID_PERIODS = ["last20", "month", "season", "all"];

const periodLabel = (p) => {
  switch (p) {
    case "month":  return "Este mês";
    case "season": return "Esta temporada";
    case "all":    return "Todas as rodadas";
    default:       return "Últimas 20 rodadas";
  }
};

// Monta a query que devolve as rodadas (id + tipo) que serão analisadas
// dentro do período. Une training_groups (finalizados) + tournaments (concluidos).
function buildRoundsQuery(period, userId, cid) {
  const unionSQL = `
    SELECT tg.id AS round_id, 'training' AS round_kind, tg.created_at AS played_at
      FROM training_groups tg
      JOIN training_participants tp ON tp.group_id = tg.id AND tp.user_id = ?
     WHERE tg.status = 'finalizado' AND tg.club_id = ?
    UNION ALL
    SELECT t.id AS round_id, 'tournament' AS round_kind, t.created_at AS played_at
      FROM tournaments t
      JOIN inscriptions i ON i.tournament_id = t.id AND i.user_id = ?
     WHERE t.status = 'concluido' AND t.club_id = ?
       AND t.modality = 'individual'
  `;
  const params = [userId, cid, userId, cid];

  switch (period) {
    case "month":
      return {
        sql: `SELECT * FROM (${unionSQL}) rounds
              WHERE played_at >= DATE_FORMAT(NOW(), '%Y-%m-01')
              ORDER BY played_at DESC`,
        params,
      };
    case "season":
      return {
        sql: `SELECT * FROM (${unionSQL}) rounds
              WHERE YEAR(played_at) = YEAR(NOW())
              ORDER BY played_at DESC`,
        params,
      };
    case "all":
      return {
        sql: `SELECT * FROM (${unionSQL}) rounds ORDER BY played_at DESC`,
        params,
      };
    case "last20":
    default:
      // LIMIT literal — mysql2 prepared statements não aceitam LIMIT parametrizado
      // em algumas versões; como o valor é fixo, embutir é seguro.
      return {
        sql: `SELECT * FROM (${unionSQL}) rounds ORDER BY played_at DESC LIMIT 20`,
        params,
      };
  }
}

async function fetchHolesForRounds(userId, trainingIds, tournamentIds) {
  const holes = [];

  if (trainingIds.length > 0) {
    const placeholders = trainingIds.map(() => "?").join(",");
    const [rows] = await db.execute(
      `SELECT tg.course_id, c.name AS course_name, ts.hole_number, ts.strokes,
              COALESCE(h.par, ch.par, 4) AS par
         FROM training_scores ts
         JOIN training_groups tg ON tg.id = ts.group_id
         LEFT JOIN courses      c  ON c.id = tg.course_id
         LEFT JOIN holes        h  ON h.course_id = tg.course_id AND h.hole_number = ts.hole_number
         LEFT JOIN course_holes ch ON ch.course_id = tg.course_id AND ch.hole_number = ts.hole_number
        WHERE ts.user_id = ? AND ts.group_id IN (${placeholders})`,
      [userId, ...trainingIds]
    );
    holes.push(...rows);
  }

  if (tournamentIds.length > 0) {
    const placeholders = tournamentIds.map(() => "?").join(",");
    const [rows] = await db.execute(
      `SELECT t.course_id, c.name AS course_name, s.hole_number, s.strokes,
              COALESCE(h.par, ch.par, 4) AS par
         FROM scores s
         JOIN tournaments   t  ON t.id = s.tournament_id
         LEFT JOIN courses      c  ON c.id = t.course_id
         LEFT JOIN holes        h  ON h.course_id = t.course_id AND h.hole_number = s.hole_number
         LEFT JOIN course_holes ch ON ch.course_id = t.course_id AND ch.hole_number = s.hole_number
        WHERE s.user_id = ? AND s.tournament_id IN (${placeholders})`,
      [userId, ...tournamentIds]
    );
    holes.push(...rows);
  }

  return holes;
}

function aggregateByPar(holes) {
  const buckets = { 3: [], 4: [], 5: [] };
  for (const h of holes) {
    const par = Number(h.par);
    if (buckets[par]) buckets[par].push(Number(h.strokes) - par);
  }
  return [3, 4, 5].map((par) => {
    const diffs = buckets[par];
    const avg = diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : 0;
    return {
      par,
      avg_diff: Number(avg.toFixed(2)),
      holes_count: diffs.length,
    };
  });
}

// Ranking dos 3 buracos com pior média de (strokes - par), exigindo mínimo
// de 3 rodadas naquele buraco específico pra evitar outlier de 1 jogo.
function aggregateHardestHoles(holes) {
  const map = new Map();
  for (const h of holes) {
    const key = `${h.course_id}::${h.hole_number}`;
    let bucket = map.get(key);
    if (!bucket) {
      bucket = {
        course_id: h.course_id,
        course_name: h.course_name || "Campo sem nome",
        hole_number: h.hole_number,
        par: Number(h.par),
        diffs: [],
      };
      map.set(key, bucket);
    }
    bucket.diffs.push(Number(h.strokes) - Number(h.par));
  }

  return Array.from(map.values())
    .filter((x) => x.diffs.length >= 3)
    .map((x) => ({
      course_name: x.course_name,
      hole_number: x.hole_number,
      par: x.par,
      avg_diff: Number((x.diffs.reduce((a, b) => a + b, 0) / x.diffs.length).toFixed(2)),
      rounds: x.diffs.length,
    }))
    .sort((a, b) => b.avg_diff - a.avg_diff)
    .slice(0, 3);
}

function buildInsight(byPar) {
  const withData = byPar.filter((x) => x.holes_count > 0);
  if (withData.length === 0) return null;

  const sorted = [...withData].sort((a, b) => b.avg_diff - a.avg_diff);
  const worst = sorted[0];

  if (worst.avg_diff <= 0) {
    return {
      type: "even_or_under",
      message: "Você está pareado com o par em todos os tipos. Continue assim.",
    };
  }

  const gap = sorted[1] ? worst.avg_diff - sorted[1].avg_diff : Infinity;
  if (gap >= 0.3) {
    const avgStrokes = worst.par + worst.avg_diff;
    return {
      type: "focused_par",
      message: `Seu maior ganho potencial está nos par ${worst.par} — em média +${worst.avg_diff.toFixed(1)} acima do par (jogando ${avgStrokes.toFixed(1)}).`,
    };
  }

  return {
    type: "balanced",
    message: "Seu jogo é equilibrado entre os tipos de buraco. O ganho vem dos buracos específicos abaixo.",
  };
}

function emptyResponse(period) {
  return {
    period,
    period_label: periodLabel(period),
    rounds_analyzed: 0,
    min_rounds_notice: true,
    by_par: [
      { par: 3, avg_diff: 0, holes_count: 0 },
      { par: 4, avg_diff: 0, holes_count: 0 },
      { par: 5, avg_diff: 0, holes_count: 0 },
    ],
    hardest_holes: [],
    insight: null,
  };
}

exports.getMyPerformance = async (req, res) => {
  try {
    const userId = req.user.id;
    const cid = clubId(req);
    const period = VALID_PERIODS.includes(req.query.period) ? req.query.period : "last20";

    const { sql, params } = buildRoundsQuery(period, userId, cid);
    const [rounds] = await db.execute(sql, params);

    if (rounds.length === 0) {
      return res.json(emptyResponse(period));
    }

    const trainingIds = rounds.filter((r) => r.round_kind === "training").map((r) => r.round_id);
    const tournamentIds = rounds.filter((r) => r.round_kind === "tournament").map((r) => r.round_id);

    const holes = await fetchHolesForRounds(userId, trainingIds, tournamentIds);

    const by_par = aggregateByPar(holes);
    const hardest_holes = aggregateHardestHoles(holes);
    const insight = buildInsight(by_par);

    // Aviso quando a base é pequena (< 10 rodadas) — front pode mostrar rodapé.
    res.json({
      period,
      period_label: periodLabel(period),
      rounds_analyzed: rounds.length,
      min_rounds_notice: rounds.length < 10,
      by_par,
      hardest_holes,
      insight,
    });
  } catch (err) {
    console.error("Erro ao gerar performance:", err);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};
