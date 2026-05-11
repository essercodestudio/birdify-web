// backend/controllers/tournamentController.js
const db = require('../db');

exports.listTournaments = async (req, res) => {
    try {
        // Pega o ID do jogador que a tela enviou para saber se ele já está inscrito
        const userId = req.query.user_id || 0; 

        const query = `
            SELECT t.*, 
                   c.name as course_name, c.city as course_city, c.state as course_state,
                   (SELECT COUNT(*) FROM inscriptions i WHERE i.tournament_id = t.id AND i.user_id = ?) as is_subscribed
            FROM tournaments t
            LEFT JOIN courses c ON t.course_id = c.id
            WHERE t.club_id = ?
            ORDER BY t.start_date DESC
        `;
        
        const [results] = await db.execute(query, [userId, req.club.id]);
        res.json(results);
        
    } catch (error) {
        console.error('Erro ao listar torneios:', error);
        res.status(500).json({ 
            error: 'Erro interno no servidor.'
        });
    }
};

// 2. BUSCAR UM TORNEIO ESPECÍFICO (Agora puxa categorias E patrocinadores limpos)
exports.getTournament = async (req, res) => {
    try {
        const { id } = req.params;
        
        const [tournamentResults] = await db.execute('SELECT * FROM tournaments WHERE id = ? AND club_id = ?', [id, req.club.id]);
        
        if (tournamentResults.length === 0) {
            return res.status(404).json({ message: "Torneio não encontrado ou acesso negado." });
        }

        const tournament = tournamentResults[0];
        
        // Remove a coluna de texto zoada (que gerava os colchetes [ e ])
        delete tournament.categories; 

        // Busca as categorias corretas
        const [catResults] = await db.execute('SELECT name FROM tournament_categories WHERE tournament_id = ?', [id]);
        tournament.categories = catResults ? catResults.map(c => c.name) : [];
        
        // Busca os patrocinadores corretos
        const [sponResults] = await db.execute('SELECT name, image_url FROM tournament_sponsors WHERE tournament_id = ?', [id]);
        tournament.sponsors = sponResults || [];
        
        res.json(tournament);
        
    } catch (error) {
        console.error('Erro ao buscar torneio:', error);
        res.status(500).json({ 
            error: 'Erro interno no servidor.'
        });
    }
};

// 3. CRIAR TORNEIO
exports.createTournament = async (req, res) => {
    try {
        const { 
            name, start_date, course_id, description, fee, payment_info, pix_key_type,
            whatsapp_contact, registration_deadline, categories, sponsors 
        } = req.body;

        // Verifica se o campo pertence ao clube
        const [courseCheck] = await db.execute(
            'SELECT id FROM courses WHERE id = ? AND club_id = ?',
            [course_id, req.club.id]
        );
        
        if (courseCheck.length === 0) {
            return res.status(403).json({ error: 'Campo não encontrado ou acesso negado.' });
        }

        const query = `
            INSERT INTO tournaments 
            (name, start_date, course_id, description, fee, payment_info, pix_key_type, whatsapp_contact, registration_deadline, club_id) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const values = [name, start_date, course_id, description, fee, payment_info, pix_key_type, whatsapp_contact, registration_deadline, req.club.id];

        const [result] = await db.execute(query, values);
        
        const tournamentId = result.insertId;

        // Inserir categorias em paralelo
        const categoryPromises = [];
        if (categories && categories.length > 0) {
            const catValues = categories.map(cat => [tournamentId, cat]);
            categoryPromises.push(
                db.query('INSERT INTO tournament_categories (tournament_id, name) VALUES ?', [catValues])
            );
        }

        // Inserir patrocinadores em paralelo
        const sponsorPromises = [];
        if (sponsors && sponsors.length > 0) {
            const sponValues = sponsors.map(s => [tournamentId, s.name, s.image_url]);
            sponsorPromises.push(
                db.query('INSERT INTO tournament_sponsors (tournament_id, name, image_url) VALUES ?', [sponValues])
            );
        }

        // Aguarda todas as inserções paralelas
        await Promise.all([...categoryPromises, ...sponsorPromises]);

        res.json({ message: 'Torneio criado!', id: tournamentId });
        
    } catch (error) {
        console.error('Erro ao criar torneio:', error);
        res.status(500).json({ 
            error: 'Erro interno no servidor.'
        });
    }
};

// 4. ATUALIZAR TORNEIO
exports.updateTournament = async (req, res) => {
    try {
        const { id } = req.params;
        const { 
            name, start_date, course_id, description, fee, payment_info, pix_key_type, 
            whatsapp_contact, registration_deadline, categories, sponsors 
        } = req.body;

        // Verifica se o torneio pertence ao clube
        const [tournamentCheck] = await db.execute(
            'SELECT id FROM tournaments WHERE id = ? AND club_id = ?',
            [id, req.club.id]
        );
        
        if (tournamentCheck.length === 0) {
            return res.status(404).json({ error: 'Torneio não encontrado ou acesso negado.' });
        }

        // Verifica se o campo pertence ao clube
        const [courseCheck] = await db.execute(
            'SELECT id FROM courses WHERE id = ? AND club_id = ?',
            [course_id, req.club.id]
        );
        
        if (courseCheck.length === 0) {
            return res.status(403).json({ error: 'Campo não encontrado ou acesso negado.' });
        }

        // 1. Atualizar dados principais do torneio
        const updateQuery = `
            UPDATE tournaments SET 
            name=?, start_date=?, course_id=?, description=?, fee=?, payment_info=?, pix_key_type=?, whatsapp_contact=?, registration_deadline=? 
            WHERE id=? AND club_id=?
        `;
        const updateValues = [name, start_date, course_id, description, fee, payment_info, pix_key_type, whatsapp_contact, registration_deadline, id, req.club.id];

        await db.execute(updateQuery, updateValues);

        // 2. Atualizar categorias
        await db.execute('DELETE FROM tournament_categories WHERE tournament_id = ?', [id]);
        
        if (categories && categories.length > 0) {
            const catValues = categories.map(cat => [id, cat]);
            await db.query('INSERT INTO tournament_categories (tournament_id, name) VALUES ?', [catValues]);
        }

        // 3. Atualizar patrocinadores
        await db.execute('DELETE FROM tournament_sponsors WHERE tournament_id = ?', [id]);
        
        if (sponsors && sponsors.length > 0) {
            const sponValues = sponsors.map(s => [id, s.name || 'Patrocinador', s.image_url || '']);
            await db.query('INSERT INTO tournament_sponsors (tournament_id, name, image_url) VALUES ?', [sponValues]);
        }

        res.json({ message: 'Torneio atualizado com sucesso!' });
        
    } catch (error) {
        console.error('Erro ao atualizar torneio:', error);
        res.status(500).json({ 
            error: 'Erro interno no servidor.'
        });
    }
};

// 5. EXCLUIR TORNEIO
exports.deleteTournament = async (req, res) => {
    try {
        const { id } = req.params;

        // Verifica se o torneio pertence ao clube antes de excluir
        const [tournamentCheck] = await db.execute(
            'SELECT id FROM tournaments WHERE id = ? AND club_id = ?',
            [id, req.club.id]
        );
        
        if (tournamentCheck.length === 0) {
            return res.status(404).json({ error: 'Torneio não encontrado ou acesso negado.' });
        }

        // Executar todas as operações de exclusão em sequência (devido às dependências de chave estrangeira)
        
        // 1. Deletar scores
        await db.execute('DELETE FROM scores WHERE tournament_id = ?', [id]);
        
        // 2. Deletar group_players (precisa do tournament_id via tournament_groups)
        await db.execute(
            'DELETE gp FROM group_players gp JOIN tournament_groups tg ON gp.group_id = tg.id WHERE tg.tournament_id = ?', 
            [id]
        );
        
        // 3. Deletar grupos do torneio
        await db.execute('DELETE FROM tournament_groups WHERE tournament_id = ?', [id]);
        
        // 4. Deletar inscrições
        await db.execute('DELETE FROM inscriptions WHERE tournament_id = ?', [id]);
        
        // 5. Deletar categorias
        await db.execute('DELETE FROM tournament_categories WHERE tournament_id = ?', [id]);
        
        // 6. Deletar patrocinadores
        await db.execute('DELETE FROM tournament_sponsors WHERE tournament_id = ?', [id]);
        
        // 7. Finalmente, deletar o torneio
        const [result] = await db.execute('DELETE FROM tournaments WHERE id = ? AND club_id = ?', [id, req.club.id]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Torneio não encontrado.' });
        }
        
        res.json({ message: 'Torneio excluído com sucesso!' });
        
    } catch (error) {
        console.error('Erro ao excluir torneio:', error);
        res.status(500).json({ 
            error: 'Erro interno no servidor.'
        });
    }
};

// 6. ALTERAR STATUS DO TORNEIO (Concluir / Reabrir)
exports.toggleStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body; // Vai receber 'ativo' ou 'concluido'
        
        // Validação básica
        if (!['ativo', 'concluido'].includes(status)) {
            return res.status(400).json({ 
                error: 'Status inválido. Use "ativo" ou "concluido".' 
            });
        }
        
        const [result] = await db.execute('UPDATE tournaments SET status = ? WHERE id = ? AND club_id = ?', [status, id, req.club.id]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Torneio não encontrado ou acesso negado.' });
        }
        
        res.json({ message: `Torneio marcado como ${status} com sucesso!` });
        
    } catch (error) {
        console.error('Erro ao alterar status do torneio:', error);
        res.status(500).json({ 
            error: 'Erro interno no servidor.'
        });
    }
};