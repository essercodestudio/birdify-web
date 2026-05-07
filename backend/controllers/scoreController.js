// backend/controllers/scoreController.js
const db = require("../db");

// Salvar (ou atualizar) o score de um buraco com Faxina Automática!
exports.saveScore = async (req, res) => {
  try {
    const { tournament_id, user_id, hole_number, strokes } = req.body;

    // Validação básica dos dados
    if (!tournament_id || !user_id || !hole_number || strokes === undefined) {
      return res.status(400).json({ 
        error: 'Dados incompletos. Envie tournament_id, user_id, hole_number e strokes.' 
      });
    }

    // Verifica se o torneio pertence ao clube
    const [tournamentCheck] = await db.execute(
      'SELECT id FROM tournaments WHERE id = ? AND club_id = ?',
      [tournament_id, req.club.id]
    );
    
    if (tournamentCheck.length === 0) {
      return res.status(403).json({ error: 'Torneio não encontrado ou acesso negado.' });
    }

    // 1. PRIMEIRO PASSO: Deleta qualquer pontuação velha ou duplicada desse jogador nesse buraco
    const deleteQuery =
      "DELETE FROM scores WHERE tournament_id = ? AND user_id = ? AND hole_number = ?";

    await db.execute(deleteQuery, [tournament_id, user_id, hole_number]);

    // 2. SEGUNDO PASSO: Insere a pontuação nova e exata, garantindo que seja a ÚNICA!
    const insertQuery =
      "INSERT INTO scores (tournament_id, user_id, hole_number, strokes) VALUES (?, ?, ?, ?)";

    await db.execute(insertQuery, [tournament_id, user_id, hole_number, strokes]);
    
    res.json({ 
      message: "Score salvo limpo e sem duplicar!", 
      strokes,
      hole: hole_number
    });
    
  } catch (error) {
    console.error('Erro ao salvar score:', error);
    res.status(500).json({ 
      error: 'Erro interno do servidor',
      message: error.message 
    });
  }
};

// Carregar todos os scores do torneio (para preencher o cartão)
exports.getScores = async (req, res) => {
  try {
    const { tournamentId } = req.params;

    if (!tournamentId) {
      return res.status(400).json({ 
        error: 'ID do torneio não fornecido.' 
      });
    }

    // Verifica se o torneio pertence ao clube
    const [tournamentCheck] = await db.execute(
      'SELECT id FROM tournaments WHERE id = ? AND club_id = ?',
      [tournamentId, req.club.id]
    );
    
    if (tournamentCheck.length === 0) {
      return res.status(403).json({ error: 'Torneio não encontrado ou acesso negado.' });
    }

    const query =
      "SELECT user_id, hole_number, strokes FROM scores WHERE tournament_id = ?";

    const [results] = await db.execute(query, [tournamentId]);
    
    res.json(results);
    
  } catch (error) {
    console.error('Erro ao buscar scores:', error);
    res.status(500).json({ 
      error: 'Erro interno do servidor',
      message: error.message 
    });
  }
};