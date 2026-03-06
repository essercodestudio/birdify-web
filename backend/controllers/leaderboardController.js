// backend/controllers/leaderboardController.js
const db = require('../db');

/// 1. LISTA GERAL (Ranking Automático Birdify com Par Dinâmico REAL e Matemática Exata)
exports.getTournamentLeaderboard = (req, res) => {
    const { tournamentId } = req.params;

    // A MÁGICA DA BLINDAGEM: Usamos uma subquery (ph) para pegar o handicap
    // sem multiplicar as linhas de score pela quantidade de grupos no torneio!
    const query = `
        SELECT 
            u.id, 
            u.name, 
            u.gender, 
            COALESCE(MAX(ph.handicap), 0) as handicap,
            COALESCE(SUM(s.strokes), 0) as total_strokes, 
            COALESCE(COUNT(s.hole_number), 0) as holes_played,
            COALESCE(SUM(s.strokes - COALESCE(h.par, ch.par, 4)), 0) as score_to_par
        FROM inscriptions i
        JOIN users u ON i.user_id = u.id
        LEFT JOIN scores s ON s.user_id = u.id AND s.tournament_id = i.tournament_id
        LEFT JOIN tournaments t ON t.id = i.tournament_id
        LEFT JOIN holes h ON h.course_id = t.course_id AND h.hole_number = s.hole_number
        LEFT JOIN course_holes ch ON ch.course_id = t.course_id AND ch.hole_number = s.hole_number
        
        -- Busca o handicap isoladamente, sem explodir as linhas
        LEFT JOIN (
            SELECT gp_inner.user_id, gp_inner.handicap 
            FROM group_players gp_inner
            JOIN tournament_groups tg_inner ON gp_inner.group_id = tg_inner.id
            WHERE tg_inner.tournament_id = ?
        ) ph ON ph.user_id = u.id
        
        WHERE i.tournament_id = ? AND i.status = 'APPROVED'
        GROUP BY u.id, u.name, u.gender
    `;

    // Note que agora passamos a variável tournamentId DUAS vezes no array 
    // (uma para a subquery 'ph' e outra para o 'WHERE' principal)
    db.query(query, [tournamentId, tournamentId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
};

// ... a função getPlayerScorecard logo abaixo continua igualzinha!

// 2. DETALHES DO JOGADOR (Para o Modal do Cartão)
exports.getPlayerScorecard = (req, res) => {
    const { tournamentId, userId } = req.params;

    const query = `
        SELECT 
            s.hole_number, 
            s.strokes, 
            COALESCE(h.par, 4) as par 
        FROM scores s
        JOIN tournaments t ON s.tournament_id = t.id
        LEFT JOIN holes h ON t.course_id = h.course_id AND s.hole_number = h.hole_number
        WHERE s.tournament_id = ? AND s.user_id = ?
        ORDER BY s.hole_number ASC
    `;

    db.query(query, [tournamentId, userId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
};