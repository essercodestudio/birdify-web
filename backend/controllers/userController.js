const db = require('../db');

exports.getAllPlayers = (req, res) => {
    // Busca apenas quem NÃO é admin
    const query = 'SELECT id, name, email FROM users WHERE role = "PLAYER" ORDER BY name';

    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
};