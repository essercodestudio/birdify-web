// backend/controllers/scoreController.js
const db = require("../db");

// Salvar (ou atualizar) o score de um buraco com Faxina Automática!
exports.saveScore = (req, res) => {
  const { tournament_id, user_id, hole_number, strokes } = req.body;

  // 1. PRIMEIRO PASSO: Deleta qualquer pontuação velha ou duplicada desse jogador nesse buraco
  const deleteQuery =
    "DELETE FROM scores WHERE tournament_id = ? AND user_id = ? AND hole_number = ?";

  db.query(deleteQuery, [tournament_id, user_id, hole_number], (err) => {
    if (err) return res.status(500).json({ error: err.message });

    // 2. SEGUNDO PASSO: Insere a pontuação nova e exata, garantindo que seja a ÚNICA!
    const insertQuery =
      "INSERT INTO scores (tournament_id, user_id, hole_number, strokes) VALUES (?, ?, ?, ?)";

    db.query(
      insertQuery,
      [tournament_id, user_id, hole_number, strokes],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Score salvo limpo e sem duplicar!", strokes });
      },
    );
  });
};

// Carregar todos os scores do torneio (para preencher o cartão)
exports.getScores = (req, res) => {
  const { tournamentId } = req.params;

  const query =
    "SELECT user_id, hole_number, strokes FROM scores WHERE tournament_id = ?";

  db.query(query, [tournamentId], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
};
