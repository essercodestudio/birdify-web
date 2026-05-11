// backend/controllers/inscriptionController.js
const db = require('../db');

// 1. Buscar detalhes completos do torneio (Categorias, Patrocinadores, etc.)
exports.getTournamentDetails = async (req, res) => {
    try {
        const { id } = req.params;
        
        // Busca o torneio (COM VERIFICAÇÃO DE CLUB_ID)
        const [tourResults] = await db.execute('SELECT * FROM tournaments WHERE id = ? AND club_id = ?', [id, req.club.id]);
        
        if (tourResults.length === 0) {
            return res.status(404).json({ message: "Torneio não encontrado ou acesso negado." });
        }
        
        const tournament = tourResults[0];
        
        // Busca as categorias desse torneio
        const [catResults] = await db.execute('SELECT * FROM tournament_categories WHERE tournament_id = ?', [id]);
        tournament.categories = catResults;
        
        // Busca os patrocinadores desse torneio
        const [sponResults] = await db.execute('SELECT * FROM tournament_sponsors WHERE tournament_id = ?', [id]);
        tournament.sponsors = sponResults;
        
        // Devolve tudo num pacote só para o Frontend
        res.json(tournament);
        
    } catch (error) {
        console.error('Erro ao buscar detalhes do torneio:', error);
        res.status(500).json({ error: 'Erro interno no servidor.' });
    }
};

// 2. O Jogador faz a inscrição
exports.createInscription = async (req, res) => {
    try {
        const { tournament_id, user_id, category_id } = req.body;
        
        // Verifica se o torneio existe e pertence ao clube
        const [tournamentCheck] = await db.execute(
            'SELECT id FROM tournaments WHERE id = ? AND club_id = ?',
            [tournament_id, req.club.id]
        );
        
        if (tournamentCheck.length === 0) {
            return res.status(404).json({ message: "Torneio não encontrado ou acesso negado." });
        }
        
        // Verifica se ele já se inscreveu antes para não duplicar
        const [existingInscriptions] = await db.execute(
            'SELECT * FROM inscriptions WHERE tournament_id = ? AND user_id = ?', 
            [tournament_id, user_id]
        );
        
        if (existingInscriptions.length > 0) {
            return res.status(400).json({ message: 'Já estás inscrito neste torneio!' });
        }
        
        // AJUSTE DE SEGURANÇA: Se category_id vier undefined (ou null do JS), passamos o null pro banco
        const safeCategoryId = category_id || null;

        // Insere a nova inscrição como PENDENTE
        const [result] = await db.execute(
            'INSERT INTO inscriptions (tournament_id, user_id, category_id, status) VALUES (?, ?, ?, "PENDING")', 
            [tournament_id, user_id, safeCategoryId]
        );
        
        res.json({ 
            message: 'Inscrição realizada com sucesso!', 
            id: result.insertId 
        });
        
    } catch (error) {
        console.error('Erro ao criar inscrição:', error);
        res.status(500).json({ error: 'Erro interno no servidor.' });
    }
};

// 3. O Admin lista os inscritos para aprovar
exports.getInscriptions = async (req, res) => {
    try {
        const { tournamentId } = req.params;
        
        // Verifica se o torneio pertence ao clube
        const [tournamentCheck] = await db.execute(
            'SELECT id FROM tournaments WHERE id = ? AND club_id = ?',
            [tournamentId, req.club.id]
        );
        
        if (tournamentCheck.length === 0) {
            return res.status(403).json({ error: 'Torneio não encontrado ou acesso negado.' });
        }
        
        // A MÁGICA: Trocamos o JOIN por LEFT JOIN na tabela de categorias.
        // Assim, mesmo que category_id seja nulo, o jogador aparece na lista do painel!
        const query = `
            SELECT i.id, i.status, u.name as player_name, c.name as category_name, i.user_id 
            FROM inscriptions i
            JOIN users u ON i.user_id = u.id
            LEFT JOIN tournament_categories c ON i.category_id = c.id
            WHERE i.tournament_id = ?
        `;
        
        const [results] = await db.execute(query, [tournamentId]);
        
        res.json(results);
        
    } catch (error) {
        console.error('Erro ao listar inscrições:', error);
        res.status(500).json({ error: 'Erro interno no servidor.' });
    }
};

// 4. O Admin aprova ou recusa a inscrição
exports.updateStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body; // Vai receber 'APPROVED' ou 'REJECTED'
        
        // Validação básica do status
        if (!['APPROVED', 'REJECTED'].includes(status)) {
            return res.status(400).json({ 
                error: 'Status inválido. Use APPROVED ou REJECTED.' 
            });
        }
        
        // Verifica se a inscrição pertence a um torneio do clube
        const [inscriptionCheck] = await db.execute(
            `SELECT i.id 
             FROM inscriptions i
             JOIN tournaments t ON i.tournament_id = t.id
             WHERE i.id = ? AND t.club_id = ?`,
            [id, req.club.id]
        );
        
        if (inscriptionCheck.length === 0) {
            return res.status(404).json({ 
                error: 'Inscrição não encontrada ou acesso negado.' 
            });
        }
        
        const [result] = await db.execute(
            'UPDATE inscriptions SET status = ? WHERE id = ?', 
            [status, id]
        );
        
        // Verifica se a inscrição foi encontrada
        if (result.affectedRows === 0) {
            return res.status(404).json({ 
                error: 'Inscrição não encontrada.' 
            });
        }
        
        res.json({ 
            message: `Inscrição atualizada para ${status}`,
            inscriptionId: id,
            newStatus: status
        });
        
    } catch (error) {
        console.error('Erro ao atualizar status da inscrição:', error);
        res.status(500).json({ error: 'Erro interno no servidor.' });
    }
};