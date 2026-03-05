// backend/controllers/scoreController.js
const db = require('../db');

// Salvar (ou atualizar) o score de um buraco
exports.saveScore = (req, res) => {
    const { tournament_id, user_id, hole_number, strokes } = req.body;

    // "ON DUPLICATE KEY UPDATE" significa:
    // Se já existe nota para este buraco, atualiza. Se não existe, cria.
    const query = `
        INSERT INTO scores (tournament_id, user_id, hole_number, strokes)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE strokes = VALUES(strokes)
    `;

    db.query(query, [tournament_id, user_id, hole_number, strokes], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Score salvo!', strokes });
    });
};

// Carregar todos os scores do torneio (para preencher o cartão)
exports.getScores = (req, res) => {
    const { tournamentId } = req.params;

    const query = 'SELECT user_id, hole_number, strokes FROM scores WHERE tournament_id = ?';

    db.query(query, [tournamentId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
};