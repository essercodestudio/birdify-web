// backend/controllers/authController.js
const db = require('../db');
const bcrypt = require('bcryptjs');

exports.register = async (req, res) => {
    try {
        // Recebe os dados do aplicativo/site
        const { name, email, password, gender, role } = req.body;

        // 1. Validação simples
        if (!name || !email || !password || !gender) {
            return res.status(400).json({ message: 'Preencha todos os campos!' });
        }

        // 2. Verifica se o e-mail já existe
        const checkQuery = 'SELECT email FROM users WHERE email = ?';
        const [existingUsers] = await db.execute(checkQuery, [email]);
        
        if (existingUsers.length > 0) {
            return res.status(400).json({ message: 'E-mail já está em uso.' });
        }

        // 3. Criptografa a senha (Segurança Máxima)
        const salt = bcrypt.genSaltSync(10);
        const hash = bcrypt.hashSync(password, salt);

        // 4. Define se é ADMIN ou PLAYER (Padrão é PLAYER)
        const userRole = role === 'ADMIN' ? 'ADMIN' : 'PLAYER';

        // 5. Salva no Banco
        const insertQuery = 'INSERT INTO users (name, email, password_hash, gender, role) VALUES (?, ?, ?, ?, ?)';
        const [result] = await db.execute(insertQuery, [name, email, hash, gender, userRole]);
        
        res.status(201).json({ 
            message: 'Usuário criado com sucesso!',
            userId: result.insertId 
        });

    } catch (error) {
        console.error('Erro no registro:', error);
        res.status(500).json({ 
            error: 'Erro interno do servidor',
            message: error.message 
        });
    }
};

// LOGIN DO USUÁRIO
exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;

        // 1. Verificar se o usuário existe
        const query = 'SELECT * FROM users WHERE email = ?';
        const [users] = await db.execute(query, [email]);
        
        // Se não encontrou ninguém com esse email
        if (users.length === 0) {
            return res.status(404).json({ message: 'Usuário não encontrado.' });
        }

        const user = users[0];

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

    } catch (error) {
        console.error('Erro no login:', error);
        res.status(500).json({ 
            error: 'Erro interno do servidor',
            message: error.message 
        });
    }
};

exports.getAllPlayers = async (req, res) => {
    try {
        // Busca apenas ID e Nome de quem não é ADMIN (ou traga todos se preferir)
        const query = "SELECT id, name FROM users ORDER BY name ASC";
        const [players] = await db.execute(query);
        
        res.json(players);
        
    } catch (error) {
        console.error("Erro ao listar jogadores:", error);
        res.status(500).json({ 
            error: 'Erro interno do servidor',
            message: error.message 
        });
    }
};