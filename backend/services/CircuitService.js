// backend/services/CircuitService.js
const db = require('../db');

async function getStageLeaderboard(tournamentId) {
  const [rows] = await db.execute(`
    SELECT
      u.id   AS player_id,
      u.name AS player_name,
      COALESCE(SUM(s.strokes - COALESCE(h.par, 4)), 0) AS score_to_par,
      i.manual_position
    FROM inscriptions i
    JOIN users u      ON i.user_id = u.id
    LEFT JOIN scores s      ON s.user_id = u.id AND s.tournament_id = i.tournament_id
    LEFT JOIN tournaments t ON t.id = i.tournament_id
    LEFT JOIN holes h       ON h.course_id = t.course_id AND h.hole_number = s.hole_number
    WHERE i.tournament_id = ? AND i.status = 'APPROVED'
    GROUP BY u.id, u.name, i.manual_position
    ORDER BY score_to_par ASC
  `, [tournamentId]);
  return rows;
}

async function calculateCircuitRanking(circuitId, clubId) {
  const [circuits] = await db.execute(
    'SELECT * FROM circuits WHERE id = ? AND club_id = ?',
    [circuitId, clubId]
  );
  if (!circuits.length) return null;
  const circuit     = circuits[0];
  const numDiscards = circuit.num_discards || 0;

  const [stages] = await db.execute(`
    SELECT cs.id, cs.stage_number, cs.tournament_id,
           t.name AS tournament_name, t.status AS tournament_status
    FROM circuit_stages cs
    JOIN tournaments t ON cs.tournament_id = t.id
    WHERE cs.circuit_id = ?
    ORDER BY cs.stage_number ASC
  `, [circuitId]);

  const [rules] = await db.execute(
    'SELECT position, points FROM circuit_point_rules WHERE circuit_id = ? ORDER BY position ASC',
    [circuitId]
  );
  const rulesMap = new Map(rules.map(r => [r.position, parseFloat(r.points)]));

  const stageResultsMap = new Map();
  const allPlayers      = new Map();

  for (const stage of stages) {
    const finished = stage.tournament_status === 'concluido';

    if (!finished) {
      stageResultsMap.set(stage.stage_number, {
        stage_number:      stage.stage_number,
        tournament_id:     stage.tournament_id,
        tournament_name:   stage.tournament_name,
        tournament_status: stage.tournament_status,
        finished:          false,
        results:           []
      });
      continue;
    }

    const leaderboard    = await getStageLeaderboard(stage.tournament_id);
    const manualPlayers  = leaderboard.filter(p => p.manual_position != null);
    const autoPlayers    = leaderboard.filter(p => p.manual_position == null);
    const results        = [];

    // Manually-positioned players → exact points for their assigned position (no sharing)
    for (const p of manualPlayers) {
      allPlayers.set(p.player_id, p.player_name);
      results.push({
        player_id: p.player_id,
        position:  p.manual_position,
        points:    rulesMap.get(p.manual_position) || 0,
        manual:    true
      });
    }

    // Auto players occupy the remaining positions in order, skipping any slot reserved
    // by a manual assignment — even if there are gaps (e.g. admin set 1st and 3rd but
    // not 2nd: the first auto player gets 2nd, the next group gets 4th & 5th, etc.).
    const takenPositions = new Set(manualPlayers.map(p => p.manual_position));
    const available      = [];
    for (let pos = 1; available.length < autoPlayers.length; pos++) {
      if (!takenPositions.has(pos)) available.push(pos);
    }

    // Group auto players by tied score and distribute points pro-rata
    let posIdx = 0;
    let i = 0;
    while (i < autoPlayers.length) {
      const tiedScore = autoPlayers[i].score_to_par;
      let j = i;
      while (j < autoPlayers.length && autoPlayers[j].score_to_par === tiedScore) j++;

      const n        = j - i;
      const groupPos = available.slice(posIdx, posIdx + n);
      let pool       = 0;
      for (const gp of groupPos) pool += rulesMap.get(gp) || 0;
      const avg = pool / n;

      for (let k = i; k < j; k++) {
        const p = autoPlayers[k];
        allPlayers.set(p.player_id, p.player_name);
        results.push({ player_id: p.player_id, position: groupPos[0], points: avg, manual: false });
      }

      posIdx += n;
      i = j;
    }

    stageResultsMap.set(stage.stage_number, {
      stage_number:      stage.stage_number,
      tournament_id:     stage.tournament_id,
      tournament_name:   stage.tournament_name,
      tournament_status: stage.tournament_status,
      finished:          true,
      results
    });
  }

  // Gender from users (static profile data)
  const playerProfiles = new Map();
  const pIds = [...allPlayers.keys()];
  if (pIds.length > 0) {
    const [genderRows] = await db.execute(
      `SELECT id, gender FROM users WHERE id IN (${pIds.map(() => '?').join(',')})`,
      pIds
    );
    genderRows.forEach(r => playerProfiles.set(r.id, { gender: r.gender || 'M' }));
  }

  // Match handicap — congelado na primeira etapa que o jogador disputou no circuito
  const [hcpRows] = await db.execute(`
    SELECT gp.user_id, gp.handicap
    FROM group_players gp
    JOIN tournament_groups tg ON gp.group_id = tg.id
    JOIN circuit_stages cs    ON cs.tournament_id = tg.tournament_id
    WHERE cs.circuit_id = ?
    ORDER BY cs.stage_number ASC
  `, [circuitId]);

  const firstStageHcp = new Map();
  for (const row of hcpRows) {
    if (!firstStageHcp.has(row.user_id)) {
      firstStageHcp.set(row.user_id, parseFloat(row.handicap || 0));
    }
  }

  const ranking = [];

  for (const [playerId, playerName] of allPlayers) {
    const profile  = playerProfiles.get(playerId) || { gender: 'M' };
    const handicap = firstStageHcp.get(playerId) ?? 0;
    const stageEntries = stages.map(stage => {
      const sd = stageResultsMap.get(stage.stage_number);

      if (!sd.finished) return {
        stage_number:    stage.stage_number,
        tournament_id:   stage.tournament_id,
        tournament_name: stage.tournament_name,
        points:          0,
        position:        null,
        participated:    false,
        pending:         true
      };

      const result = sd.results.find(r => r.player_id === playerId);
      if (result) return {
        stage_number:    stage.stage_number,
        tournament_id:   stage.tournament_id,
        tournament_name: stage.tournament_name,
        points:          result.points,
        position:        result.position,
        participated:    true,
        pending:         false
      };

      return {
        stage_number:    stage.stage_number,
        tournament_id:   stage.tournament_id,
        tournament_name: stage.tournament_name,
        points:          0,
        position:        null,
        participated:    false,
        pending:         false
      };
    });

    const finishedEntries = stageEntries.filter(s => !s.pending);
    const total_bruto     = finishedEntries.reduce((sum, s) => sum + s.points, 0);
    let   total_oficial   = total_bruto;
    let   discardedStages = [];

    if (numDiscards > 0 && finishedEntries.length > numDiscards) {
      const sorted = [...finishedEntries].sort((a, b) => {
        if (!a.participated && b.participated)  return -1;
        if (a.participated  && !b.participated) return  1;
        return a.points - b.points;
      });
      discardedStages = sorted.slice(0, numDiscards);
      total_oficial   = total_bruto - discardedStages.reduce((sum, s) => sum + s.points, 0);
    }

    ranking.push({
      player_id:   playerId,
      player_name: playerName,
      handicap,
      gender:      profile.gender,
      total_bruto,
      total_oficial,
      discarded_stages: discardedStages.map(s => ({
        stage_number:    s.stage_number,
        tournament_name: s.tournament_name,
        points:          s.points,
        participated:    s.participated
      })),
      // backward compat — keep single discarded_stage
      discarded_stage: discardedStages[0] ? {
        stage_number:    discardedStages[0].stage_number,
        tournament_name: discardedStages[0].tournament_name,
        points:          discardedStages[0].points,
        participated:    discardedStages[0].participated
      } : null,
      stages: stageEntries
    });
  }

  ranking.sort((a, b) => b.total_oficial - a.total_oficial);

  return {
    circuit: {
      id:           circuit.id,
      name:         circuit.name,
      description:  circuit.description,
      total_stages: circuit.total_stages,
      num_discards: numDiscards,
      has_discard:  numDiscards > 0
    },
    stages: stages.map(s => ({
      stage_id:          s.id,
      stage_number:      s.stage_number,
      tournament_id:     s.tournament_id,
      tournament_name:   s.tournament_name,
      tournament_status: s.tournament_status,
      finished:          s.tournament_status === 'concluido'
    })),
    ranking
  };
}

module.exports = { calculateCircuitRanking };
