// backend/controllers/tournamentController.js
const db = require('../db');

exports.listTournaments = (req, res) => {
    // Pega o ID do jogador que a tela enviou para saber se ele já está inscrito
    const userId = req.query.user_id || 0; 

    const query = `
        SELECT t.*, 
               c.name as course_name, c.city as course_city, c.state as course_state,
               (SELECT COUNT(*) FROM inscriptions i WHERE i.tournament_id = t.id AND i.user_id = ?) as is_subscribed
        FROM tournaments t
        LEFT JOIN courses c ON t.course_id = c.id
        ORDER BY t.start_date DESC
    `;
    
    db.query(query, [userId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
};

// 2. BUSCAR UM TORNEIO ESPECÍFICO (Agora puxa categorias E patrocinadores limpos)
exports.getTournament = (req, res) => {
    const { id } = req.params;
    db.query('SELECT * FROM tournaments WHERE id = ?', [id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0) return res.status(404).json({ message: "Torneio não encontrado" });

        const tournament = results[0];
        
        // Remove a coluna de texto zoada (que gerava os colchetes [ e ])
        delete tournament.categories; 

        // Busca as categorias corretas
        db.query('SELECT name FROM tournament_categories WHERE tournament_id = ?', [id], (err, catResults) => {
            tournament.categories = catResults ? catResults.map(c => c.name) : [];
            
            // Busca os patrocinadores corretos
            db.query('SELECT name, image_url FROM tournament_sponsors WHERE tournament_id = ?', [id], (err, sponResults) => {
                tournament.sponsors = sponResults || [];
                res.json(tournament);
            });
        });
    });
};

// 3. CRIAR TORNEIO
exports.createTournament = (req, res) => {
    const { 
        name, start_date, course_id, description, fee, payment_info, pix_key_type,
        whatsapp_contact, registration_deadline, categories, sponsors 
    } = req.body;

    const query = `
        INSERT INTO tournaments 
        (name, start_date, course_id, description, fee, payment_info, pix_key_type, whatsapp_contact, registration_deadline) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const values = [name, start_date, course_id, description, fee, payment_info, pix_key_type, whatsapp_contact, registration_deadline];

    db.query(query, values, (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        
        const tournamentId = result.insertId;

        if (categories && categories.length > 0) {
            const catValues = categories.map(cat => [tournamentId, cat]);
            db.query('INSERT INTO tournament_categories (tournament_id, name) VALUES ?', [catValues], () => {});
        }

        if (sponsors && sponsors.length > 0) {
            const sponValues = sponsors.map(s => [tournamentId, s.name, s.image_url]);
            db.query('INSERT INTO tournament_sponsors (tournament_id, name, image_url) VALUES ?', [sponValues], () => {});
        }

        res.json({ message: 'Torneio criado!', id: tournamentId });
    });
};

// 4. ATUALIZAR TORNEIO
exports.updateTournament = (req, res) => {
    const { id } = req.params;
    const { 
        name, start_date, course_id, description, fee, payment_info, pix_key_type, 
        whatsapp_contact, registration_deadline, categories, sponsors 
    } = req.body;

    const query = `
        UPDATE tournaments SET 
        name=?, start_date=?, course_id=?, description=?, fee=?, payment_info=?, pix_key_type=?, whatsapp_contact=?, registration_deadline=? 
        WHERE id=?
    `;
    const values = [name, start_date, course_id, description, fee, payment_info, pix_key_type, whatsapp_contact, registration_deadline, id];

    db.query(query, values, (err) => {
        if (err) return res.status(500).json({ error: err.message });

        db.query('DELETE FROM tournament_categories WHERE tournament_id = ?', [id], () => {
            if (categories && categories.length > 0) {
                const catValues = categories.map(cat => [id, cat]);
                db.query('INSERT INTO tournament_categories (tournament_id, name) VALUES ?', [catValues], () => {});
            }

            db.query('DELETE FROM tournament_sponsors WHERE tournament_id = ?', [id], () => {
                if (sponsors && sponsors.length > 0) {
                    const sponValues = sponsors.map(s => [id, s.name || 'Patrocinador', s.image_url || '']);
                    db.query('INSERT INTO tournament_sponsors (tournament_id, name, image_url) VALUES ?', [sponValues], () => {
                        return res.json({ message: 'Torneio atualizado com sucesso!' });
                    });
                } else {
                    return res.json({ message: 'Torneio atualizado com sucesso!' });
                }
            });
        });
    });
};
// 5. EXCLUIR TORNEIO
exports.deleteTournament = (req, res) => {
    const { id } = req.params;
    db.query('DELETE FROM scores WHERE tournament_id = ?', [id], () => {
        db.query('DELETE gp FROM group_players gp JOIN tournament_groups tg ON gp.group_id = tg.id WHERE tg.tournament_id = ?', [id], () => {
            db.query('DELETE FROM tournament_groups WHERE tournament_id = ?', [id], () => {
                db.query('DELETE FROM tournament_categories WHERE tournament_id = ?', [id], () => {
                    db.query('DELETE FROM tournament_sponsors WHERE tournament_id = ?', [id], () => {
                        db.query('DELETE FROM tournaments WHERE id = ?', [id], (err) => {
                            if (err) return res.status(500).json({ error: err.message });
                            res.json({ message: 'Torneio excluído com sucesso!' });
                        });
                    });
                });
            });
        });
    });
};
// 6. ALTERAR STATUS DO TORNEIO (Concluir / Reabrir)
exports.toggleStatus = (req, res) => {
    const { id } = req.params;
    const { status } = req.body; // Vai receber 'ativo' ou 'concluido'
    
    db.query('UPDATE tournaments SET status = ? WHERE id = ?', [status, id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: `Torneio marcado como ${status} com sucesso!` });
    });
};