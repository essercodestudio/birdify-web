// backend/controllers/leaderboardController.js
const db = require('../db');

/// 1. LISTA GERAL (Ranking Automático Birdify com Par Dinâmico REAL)
exports.getTournamentLeaderboard = (req, res) => {
    const { tournamentId } = req.params;

    // A MÁGICA: Agora buscamos o Par nas DUAS tabelas possíveis (holes e course_holes)
    // Igualzinho o Cartão de Score faz, garantindo que ele ache o Par 3 e o Par 5!
    const query = `
        SELECT 
            u.id, 
            u.name, 
            u.gender, 
            COALESCE(MAX(gp.handicap), 0) as handicap,
            COALESCE(SUM(s.strokes), 0) as total_strokes, 
            COALESCE(COUNT(s.hole_number), 0) as holes_played,
            COALESCE(SUM(s.strokes - COALESCE(h.par, ch.par, 4)), 0) as score_to_par
        FROM inscriptions i
        JOIN users u ON i.user_id = u.id
        LEFT JOIN scores s ON s.user_id = u.id AND s.tournament_id = i.tournament_id
        LEFT JOIN tournaments t ON t.id = i.tournament_id
        LEFT JOIN holes h ON h.course_id = t.course_id AND h.hole_number = s.hole_number
        LEFT JOIN course_holes ch ON ch.course_id = t.course_id AND ch.hole_number = s.hole_number
        LEFT JOIN tournament_groups tg ON tg.tournament_id = i.tournament_id
        LEFT JOIN group_players gp ON gp.group_id = tg.id AND gp.user_id = u.id
        WHERE i.tournament_id = ? AND i.status = 'APPROVED'
        GROUP BY u.id, u.name, u.gender
    `;

    db.query(query, [tournamentId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
};

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