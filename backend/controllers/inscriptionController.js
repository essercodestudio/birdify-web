// backend/controllers/inscriptionController.js
const db = require('../db');

// 1. Buscar detalhes completos do torneio (Categorias, Patrocinadores, etc.)
exports.getTournamentDetails = (req, res) => {
    const { id } = req.params;
    
    // Busca o torneio
    db.query('SELECT * FROM tournaments WHERE id = ?', [id], (err, tourResults) => {
        if (err) return res.status(500).json({ error: err.message });
        if (tourResults.length === 0) return res.status(404).json({ message: "Torneio não encontrado" });
        
        const tournament = tourResults[0];
        
        // Busca as categorias desse torneio
        db.query('SELECT * FROM tournament_categories WHERE tournament_id = ?', [id], (err, catResults) => {
            if (err) return res.status(500).json({ error: err.message });
            tournament.categories = catResults;
            
            // Busca os patrocinadores desse torneio
            db.query('SELECT * FROM tournament_sponsors WHERE tournament_id = ?', [id], (err, sponResults) => {
                if (err) return res.status(500).json({ error: err.message });
                tournament.sponsors = sponResults;
                
                // Devolve tudo num pacote só para o Frontend
                res.json(tournament);
            });
        });
    });
};

// 2. O Jogador faz a inscrição
exports.createInscription = (req, res) => {
    const { tournament_id, user_id, category_id } = req.body;
    
    // Verifica se ele já se inscreveu antes para não duplicar
    db.query('SELECT * FROM inscriptions WHERE tournament_id = ? AND user_id = ?', [tournament_id, user_id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length > 0) {
            return res.status(400).json({ message: 'Já estás inscrito neste torneio!' });
        }
        
        // Insere a nova inscrição como PENDENTE
        db.query('INSERT INTO inscriptions (tournament_id, user_id, category_id, status) VALUES (?, ?, ?, "PENDING")', 
        [tournament_id, user_id, category_id], (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Inscrição realizada com sucesso!', id: result.insertId });
        });
    });
};

// 3. O Admin lista os inscritos para aprovar
exports.getInscriptions = (req, res) => {
    const { tournamentId } = req.params;
    const query = `
        SELECT i.id, i.status, u.name as player_name, c.name as category_name, i.user_id 
        FROM inscriptions i
        JOIN users u ON i.user_id = u.id
        JOIN tournament_categories c ON i.category_id = c.id
        WHERE i.tournament_id = ?
    `;
    db.query(query, [tournamentId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
};

// 4. O Admin aprova ou recusa a inscrição
exports.updateStatus = (req, res) => {
    const { id } = req.params;
    const { status } = req.body; // Vai receber 'APPROVED' ou 'REJECTED'
    
    db.query('UPDATE inscriptions SET status = ? WHERE id = ?', [status, id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: `Inscrição atualizada para ${status}` });
    });
};