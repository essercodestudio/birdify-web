// backend/controllers/authController.js
const db = require('../db');
const bcrypt = require('bcryptjs');

exports.register = (req, res) => {
    // Recebe os dados do aplicativo/site
    const { name, email, password, gender, role } = req.body;

    // 1. Validação simples
    if (!name || !email || !password || !gender) {
        return res.status(400).json({ message: 'Preencha todos os campos!' });
    }

    // 2. Verifica se o e-mail já existe
    const checkQuery = 'SELECT email FROM users WHERE email = ?';
    db.query(checkQuery, [email], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        
        if (results.length > 0) {
            return res.status(400).json({ message: 'E-mail já está em uso.' });
        }

        // 3. Criptografa a senha (Segurança Máxima)
        const salt = bcrypt.genSaltSync(10);
        const hash = bcrypt.hashSync(password, salt);

        // 4. Define se é ADMIN ou PLAYER (Padrão é PLAYER)
        const userRole = role === 'ADMIN' ? 'ADMIN' : 'PLAYER';

        // 5. Salva no Banco
        const insertQuery = 'INSERT INTO users (name, email, password_hash, gender, role) VALUES (?, ?, ?, ?, ?)';
        
        db.query(insertQuery, [name, email, hash, gender, userRole], (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            
            res.status(201).json({ 
                message: 'Usuário criado com sucesso!',
                userId: result.insertId 
            });
        });
    });
};
// LOGIN DO USUÁRIO
exports.login = (req, res) => {
    const { email, password } = req.body;

    // 1. Verificar se o usuário existe
    const query = 'SELECT * FROM users WHERE email = ?';
    
    db.query(query, [email], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        
        // Se não encontrou ninguém com esse email
        if (results.length === 0) {
            return res.status(404).json({ message: 'Usuário não encontrado.' });
        }

        const user = results[0];

        // 2. Comparar a senha (A mágica do Bcrypt)
        // Ele pega a senha "senha123" e vê se bate com o hash "$2a$10$..."
        const isMatch = bcrypt.compareSync(password, user.password_hash);

        if (!isMatch) {
            return res.status(400).json({ message: 'Senha incorreta.' });
        }

        // 3. Login Sucesso! Retornar dados (menos a senha)
        res.json({
            message: 'Login realizado com sucesso!',
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                gender: user.gender
            }
        });
    });
};
exports.getAllPlayers = (req, res) => {
    // Busca apenas ID e Nome de quem não é ADMIN (ou traga todos se preferir)
    const query = "SELECT id, name FROM users ORDER BY name ASC";
    
    db.query(query, (err, results) => {
        if (err) {
            console.error("Erro ao listar jogadores:", err);
            return res.status(500).json({ error: err.message });
        }
        res.json(results);
    });
};