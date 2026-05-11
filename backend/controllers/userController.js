const db = require('../db');

exports.getAllPlayers = async (req, res) => {
    try {
        // Busca apenas quem NÃO é admin
        const query = 'SELECT id, name, email FROM users WHERE role = "PLAYER" ORDER BY name';

        const [results] = await db.execute(query);
        
        res.json(results);
        
    } catch (error) {
        console.error('Erro ao buscar jogadores:', error);
        res.status(500).json({ 
            error: 'Erro interno no servidor.'
        });
    }
};