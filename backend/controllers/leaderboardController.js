// backend/controllers/leaderboardController.js
const db = require("../db");

/// 1. LISTA GERAL (Ranking Automático Birdify com Par Dinâmico REAL e Matemática Exata)
// Item 5 · commit 2 (2026-08-28): aceita query param ?round=all|1|2|3 pra multi-rodada.
//   - all  (default): soma tacadas de TODAS as rodadas (mantém comportamento antigo pra single-round)
//   - N:  filtra só a rodada N (usa course_id daquela rodada pro par)
// Response passa a incluir { ranking, total_rounds, rounds[], filter_round } pra
// frontend renderizar o seletor. Frontend antigo (que não usa esses campos) pode
// continuar consumindo a resposta como array via ranking (ver retrocompat abaixo).
exports.getTournamentLeaderboard = async (req, res) => {
  try {
    const { tournamentId } = req.params;

    // Verifica se o torneio pertence ao clube + pega metadata multi-rodada + modality
    const [tournamentCheck] = await db.execute(
      'SELECT id, total_rounds, modality FROM tournaments WHERE id = ? AND club_id = ?',
      [tournamentId, req.club.id]
    );

    if (tournamentCheck.length === 0) {
      return res.status(403).json({ error: 'Torneio não encontrado ou acesso negado.' });
    }
    const totalRounds = Number(tournamentCheck[0].total_rounds) || 1;
    const modality = tournamentCheck[0].modality || 'individual';

    // Parse do filtro. 'all' (ou ausente) = sem filtro; N inteiro = filtra por round.
    const roundParam = req.query.round;
    let filterRound = null;
    if (roundParam !== undefined && roundParam !== '' && roundParam !== 'all') {
      const rn = Number(roundParam);
      if (!Number.isInteger(rn) || rn < 1 || rn > totalRounds) {
        return res.status(400).json({ error: `round inválido — use 'all' ou 1..${totalRounds}.` });
      }
      filterRound = rn;
    }

    // Onda B · Commit 3.6: torneio doubles agrega por dupla_id em vez de user_id.
    // Categoria derivada dos generos dos 2 jogadores: Masculina (M+M), Feminina
    // (F+F), Mista (M+F), Livre (fallback / catch-all). Frontend bucketiza.
    if (modality === 'doubles') {
      const scoreRoundFilterD = filterRound !== null ? 'AND s.round_number = ?' : '';
      const scoreRoundParamsD = filterRound !== null ? [filterRound] : [];
      const [rows] = await db.execute(
        `SELECT
           d.id AS dupla_id,
           d.dupla_name,
           d.handicap,
           GROUP_CONCAT(u.name ORDER BY u.name SEPARATOR ' & ') AS players_names,
           GROUP_CONCAT(u.gender ORDER BY u.name SEPARATOR '') AS gender_concat,
           COALESCE(SUM(s.strokes), 0) AS total_strokes,
           COALESCE(COUNT(s.hole_number), 0) AS holes_played,
           COALESCE(SUM(s.strokes - COALESCE(h.par, ch.par, hf.par, chf.par, 4)), 0) AS score_to_par,
           COALESCE(SUM(trp.points), 0) AS total_points
         FROM tournament_duplas d
         LEFT JOIN tournament_dupla_players tdp ON tdp.dupla_id = d.id
         LEFT JOIN users u ON u.id = tdp.user_id
         LEFT JOIN scores s
                ON s.dupla_id = d.id AND s.tournament_id = d.tournament_id
                ${scoreRoundFilterD}
         LEFT JOIN tournaments t ON t.id = d.tournament_id
         LEFT JOIN tournament_rounds tr
                ON tr.tournament_id = s.tournament_id AND tr.round_number = s.round_number
         LEFT JOIN holes h        ON h.course_id  = tr.course_id AND h.hole_number  = s.hole_number
         LEFT JOIN course_holes ch ON ch.course_id = tr.course_id AND ch.hole_number = s.hole_number
         LEFT JOIN holes hf        ON hf.course_id  = t.course_id AND hf.hole_number  = s.hole_number
         LEFT JOIN course_holes chf ON chf.course_id = t.course_id AND chf.hole_number = s.hole_number
         LEFT JOIN tournament_result_points trp
                ON trp.tournament_id = s.tournament_id AND trp.result_kind = s.result_kind
         WHERE d.tournament_id = ?
         GROUP BY d.id, d.dupla_name, d.handicap`,
        [...scoreRoundParamsD, tournamentId]
      );
      // Deriva categoria a partir de gender_concat ('MM','FF','MF','FM','M','F',null).
      const withCategory = rows.map(r => {
        const g = (r.gender_concat || '').toUpperCase();
        let category = 'Livre';
        if (g === 'MM') category = 'Masculina';
        else if (g === 'FF') category = 'Feminina';
        else if (g === 'MF' || g === 'FM') category = 'Mista';
        // Dupla incompleta (1 player só) fica em Livre.
        return { ...r, category };
      });
      return res.json(withCategory);
    }

    // ────────────────────── Torneio individual (comportamento antigo) ──────────────
    // Query principal — o par vem do course da RODADA (via tr.course_id), com
    // fallback pro course do torneio pra torneios legados/single-round onde
    // tournament_rounds ainda espelha t.course_id. Isso resolve o caso de rodadas
    // em campos diferentes num torneio multi (o par muda por round).
    const scoreRoundFilter = filterRound !== null ? 'AND s.round_number = ?' : '';
    const scoreRoundParams = filterRound !== null ? [filterRound] : [];

    const query = `
      SELECT
        u.id,
        u.name,
        u.gender,
        COALESCE(MAX(ph.handicap), 0) as handicap,
        COALESCE(SUM(s.strokes), 0) as total_strokes,
        COALESCE(COUNT(s.hole_number), 0) as holes_played,
        COALESCE(SUM(s.strokes - COALESCE(h.par, ch.par, hf.par, chf.par, 4)), 0) as score_to_par,
        -- Onda A · commit 4: SUM dos pontos configurados por resultado. NULL em
        -- torneio strokes (s.result_kind IS NULL → JOIN vazio → SUM=0). Em torneio
        -- result_points, cada linha de scores casa com uma entrada de
        -- tournament_result_points, e SUM devolve o total de pontos do jogador.
        COALESCE(SUM(trp.points), 0) as total_points
      FROM inscriptions i
      JOIN users u ON i.user_id = u.id
      LEFT JOIN scores s
        ON s.user_id = u.id
       AND s.tournament_id = i.tournament_id
       ${scoreRoundFilter}
      LEFT JOIN tournaments t ON t.id = i.tournament_id
      -- Curso da rodada específica (multi-round). Se não existir linha em
      -- tournament_rounds pra esse round (dado antigo), cai no fallback do torneio.
      LEFT JOIN tournament_rounds tr
        ON tr.tournament_id = s.tournament_id AND tr.round_number = s.round_number
      LEFT JOIN holes h        ON h.course_id  = tr.course_id AND h.hole_number  = s.hole_number
      LEFT JOIN course_holes ch ON ch.course_id = tr.course_id AND ch.hole_number = s.hole_number
      -- Fallback pro course do próprio torneio (single-round legado)
      LEFT JOIN holes hf        ON hf.course_id  = t.course_id AND hf.hole_number  = s.hole_number
      LEFT JOIN course_holes chf ON chf.course_id = t.course_id AND chf.hole_number = s.hole_number
      -- Config de pontos por resultado (Onda A · commit 4). Só casa quando
      -- s.result_kind IS NOT NULL (torneios result_points).
      LEFT JOIN tournament_result_points trp
        ON trp.tournament_id = s.tournament_id AND trp.result_kind = s.result_kind

      -- Handicap por jogador. GROUP BY user_id e MAX(handicap) sao OBRIGATORIOS
      -- pos-Bloco D (2026-08-28): grupos passaram a ser por rodada, entao o
      -- mesmo user pode estar em N grupos do mesmo torneio. Sem o GROUP BY, esta
      -- subquery devolvia N linhas por user, e cada linha de scores era contada
      -- N vezes no LEFT JOIN — inflando holes_played, total_strokes e score_to_par
      -- na proporcao do numero de grupos (ver hotfix 2026-08-29, torneio ASPIRANTES 116).
      LEFT JOIN (
        SELECT gp_inner.user_id, MAX(gp_inner.handicap) AS handicap
        FROM group_players gp_inner
        JOIN tournament_groups tg_inner ON gp_inner.group_id = tg_inner.id
        WHERE tg_inner.tournament_id = ?
        GROUP BY gp_inner.user_id
      ) ph ON ph.user_id = u.id

      WHERE i.tournament_id = ? AND i.status = 'APPROVED'
      GROUP BY u.id, u.name, u.gender
    `;

    const [results] = await db.execute(query, [...scoreRoundParams, tournamentId, tournamentId]);

    // Retrocompat estrita: response continua array puro. Metadados multi-rodada
    // (total_rounds, rounds[]) já vêm em GET /tournaments/:id — frontend faz as
    // duas chamadas em paralelo e combina, mesmo padrão do Leaderboard.js atual.
    res.json(results);
  } catch (error) {
    console.error('Erro ao buscar leaderboard:', error);
    res.status(500).json({
      error: 'Erro interno no servidor.'
    });
  }
};

// 2. DETALHES DO JOGADOR (Para o Modal do Cartão)
// Item 5 · commit 2: retorna round_number em cada linha e suporta filtro ?round=N.
// Par vem do course da rodada (via tournament_rounds), fallback pro course do torneio.
exports.getPlayerScorecard = async (req, res) => {
  try {
    const { tournamentId, userId } = req.params;
    const roundParam = req.query.round;

    // Verifica se o torneio pertence ao clube + pega total_rounds pra validar
    const [tournamentCheck] = await db.execute(
      'SELECT id, total_rounds FROM tournaments WHERE id = ? AND club_id = ?',
      [tournamentId, req.club.id]
    );

    if (tournamentCheck.length === 0) {
      return res.status(403).json({ error: 'Torneio não encontrado ou acesso negado.' });
    }
    const totalRounds = Number(tournamentCheck[0].total_rounds) || 1;

    let filterRound = null;
    if (roundParam !== undefined && roundParam !== '' && roundParam !== 'all') {
      const rn = Number(roundParam);
      if (!Number.isInteger(rn) || rn < 1 || rn > totalRounds) {
        return res.status(400).json({ error: `round inválido — use 'all' ou 1..${totalRounds}.` });
      }
      filterRound = rn;
    }

    const roundFilter = filterRound !== null ? 'AND s.round_number = ?' : '';
    const params = filterRound !== null
      ? [tournamentId, userId, filterRound]
      : [tournamentId, userId];

    // Onda A · commit 4: retorna result_kind + points (via LEFT JOIN em
    // tournament_result_points). Torneio strokes → result_kind NULL, points NULL.
    const query = `
      SELECT
        s.hole_number,
        s.round_number,
        s.strokes,
        s.result_kind,
        trp.points,
        COALESCE(h.par, hf.par, 4) as par
      FROM scores s
      JOIN tournaments t ON s.tournament_id = t.id
      LEFT JOIN tournament_rounds tr
        ON tr.tournament_id = s.tournament_id AND tr.round_number = s.round_number
      LEFT JOIN holes h  ON h.course_id  = tr.course_id AND h.hole_number = s.hole_number
      LEFT JOIN holes hf ON hf.course_id = t.course_id  AND hf.hole_number = s.hole_number
      LEFT JOIN tournament_result_points trp
        ON trp.tournament_id = s.tournament_id AND trp.result_kind = s.result_kind
      WHERE s.tournament_id = ? AND s.user_id = ? ${roundFilter}
      ORDER BY s.round_number ASC, s.hole_number ASC
    `;

    const [results] = await db.execute(query, params);
    res.json(results);
  } catch (error) {
    console.error('Erro ao buscar scorecard do jogador:', error);
    res.status(500).json({
      error: 'Erro interno no servidor.'
    });
  }
};

// Onda B · Commit 3.6: scorecard buraco-a-buraco de uma DUPLA. Espelha
// getPlayerScorecard mas filtra por dupla_id em vez de user_id. Multi-tenant
// via JOIN com tournament_duplas (garante dupla pertence a torneio do clube).
exports.getDuplaScorecard = async (req, res) => {
  try {
    const { tournamentId, duplaId } = req.params;
    const roundParam = req.query.round;

    const [tournamentCheck] = await db.execute(
      `SELECT t.id, t.total_rounds
         FROM tournaments t
         JOIN tournament_duplas d ON d.tournament_id = t.id
        WHERE t.id = ? AND t.club_id = ? AND d.id = ?`,
      [tournamentId, req.club.id, duplaId]
    );
    if (tournamentCheck.length === 0) {
      return res.status(403).json({ error: 'Torneio ou dupla não encontrado / acesso negado.' });
    }
    const totalRounds = Number(tournamentCheck[0].total_rounds) || 1;

    let filterRound = null;
    if (roundParam !== undefined && roundParam !== '' && roundParam !== 'all') {
      const rn = Number(roundParam);
      if (!Number.isInteger(rn) || rn < 1 || rn > totalRounds) {
        return res.status(400).json({ error: `round inválido — use 'all' ou 1..${totalRounds}.` });
      }
      filterRound = rn;
    }

    const roundFilter = filterRound !== null ? 'AND s.round_number = ?' : '';
    const params = filterRound !== null
      ? [tournamentId, duplaId, filterRound]
      : [tournamentId, duplaId];

    const [results] = await db.execute(
      `SELECT
         s.hole_number,
         s.round_number,
         s.strokes,
         s.result_kind,
         trp.points,
         COALESCE(h.par, hf.par, 4) as par
       FROM scores s
       JOIN tournaments t ON s.tournament_id = t.id
       LEFT JOIN tournament_rounds tr
         ON tr.tournament_id = s.tournament_id AND tr.round_number = s.round_number
       LEFT JOIN holes h  ON h.course_id  = tr.course_id AND h.hole_number = s.hole_number
       LEFT JOIN holes hf ON hf.course_id = t.course_id  AND hf.hole_number = s.hole_number
       LEFT JOIN tournament_result_points trp
         ON trp.tournament_id = s.tournament_id AND trp.result_kind = s.result_kind
       WHERE s.tournament_id = ? AND s.dupla_id = ? ${roundFilter}
       ORDER BY s.round_number ASC, s.hole_number ASC`,
      params
    );
    res.json(results);
  } catch (error) {
    console.error('Erro ao buscar scorecard da dupla:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};