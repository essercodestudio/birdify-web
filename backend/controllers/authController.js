// backend/controllers/authController.js
const db = require("../db");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

// 1. REGISTRO
exports.register = async (req, res) => {
  try {
    const { name, email, password, gender, role } = req.body;

    if (!name || !email || !password || !gender) {
      return res.status(400).json({ message: "Preencha todos os campos!" });
    }

    const checkQuery = "SELECT email FROM users WHERE email = ?";
    const [existingUsers] = await db.execute(checkQuery, [email]);

    if (existingUsers.length > 0) {
      return res.status(400).json({ message: "E-mail já está em uso." });
    }

    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(password, salt);
    const userRole = role === "ADMIN" ? "ADMIN" : "PLAYER";

    const insertQuery =
      "INSERT INTO users (name, email, password_hash, gender, role) VALUES (?, ?, ?, ?, ?)";
    const [result] = await db.execute(insertQuery, [
      name,
      email,
      hash,
      gender,
      userRole,
    ]);

    res
      .status(201)
      .json({
        message: "Usuário criado com sucesso!",
        userId: result.insertId,
      });
  } catch (error) {
    console.error("Erro no registro:", error);
    res.status(500).json({ error: "Erro interno", message: error.message });
  }
};

// 2. LOGIN
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const query = "SELECT * FROM users WHERE email = ?";
    const [users] = await db.execute(query, [email]);

    if (users.length === 0)
      return res.status(404).json({ message: "Usuário não encontrado." });

    const user = users[0];
    const isMatch = bcrypt.compareSync(password, user.password_hash);

    if (!isMatch) return res.status(400).json({ message: "Senha incorreta." });

    res.json({
      message: "Login realizado com sucesso!",
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        gender: user.gender,
      },
    });
  } catch (error) {
    console.error("Erro no login:", error);
    res.status(500).json({ error: "Erro interno", message: error.message });
  }
};

// 3. LISTAR JOGADORES
exports.getAllPlayers = async (req, res) => {
  try {
    const query = "SELECT id, name FROM users ORDER BY name ASC";
    const [players] = await db.execute(query);
    res.json(players);
  } catch (error) {
    console.error("Erro ao listar jogadores:", error);
    res.status(500).json({ error: "Erro interno", message: error.message });
  }
};

// ==========================================
// NOVAS FUNÇÕES: RECUPERAÇÃO DE SENHA
// ==========================================

// 4. ESQUECI MINHA SENHA (Envia o e-mail)
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    // Verifica se usuário existe
    const query = "SELECT id, name FROM users WHERE email = ?";
    const [users] = await db.execute(query, [email]);
    if (users.length === 0) {
      return res
        .status(404)
        .json({
          message: "Se esse e-mail estiver cadastrado, um link será enviado.",
        }); // Mensagem genérica por segurança
    }

    const user = users[0];

    // Gera Token e Validade (1 hora)
    const resetToken = crypto.randomBytes(20).toString("hex");
    const resetExpires = new Date(Date.now() + 3600000); // Exatamente 1 hora a partir de agora

    // Salva no banco
    const updateQuery =
      "UPDATE users SET reset_password_token = ?, reset_password_expires = ? WHERE email = ?";
    await db.execute(updateQuery, [resetToken, resetExpires, email]);

    // Configura o E-mail usando as variáveis do .env
    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST, // Vai puxar smtp.gmail.com
      port: 465,
      secure: true,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS, // Vai usar a senha mágica de 16 letras
      },
    });

    // Link que o usuário vai clicar
    // ATENÇÃO: Na produção, mude localhost:3000 para o seu domínio real
    const resetUrl = `http://birdify.com.br/reset-password/${resetToken}`;

    const mailOptions = {
      from: '"Suporte Birdify" <suporte@birdify.com.br>',
      to: email,
      subject: "Recuperação de Senha - Birdify",
      html: `
                <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
                    <h2 style="color: #22c55e;">Olá, ${user.name}!</h2>
                    <p>Recebemos um pedido para redefinir sua senha no Birdify.</p>
                    <p>Clique no botão abaixo para criar uma nova senha (o link expira em 1 hora):</p>
                    <a href="${resetUrl}" style="display: inline-block; padding: 12px 20px; background-color: #22c55e; color: #fff; text-decoration: none; border-radius: 5px; font-weight: bold; margin-top: 10px;">Redefinir Minha Senha</a>
                    <p style="margin-top: 20px; font-size: 12px; color: #999;">Se não foi você que solicitou, pode ignorar este e-mail.</p>
                </div>
            `,
    };

    await transporter.sendMail(mailOptions);
    res.json({ message: "E-mail de recuperação enviado com sucesso!" });
  } catch (error) {
    console.error("Erro ao solicitar recuperação:", error);
    res
      .status(500)
      .json({ error: "Erro ao enviar e-mail", message: error.message });
  }
};

// 5. REDEFINIR A SENHA (Quando o usuário digita a senha nova)
exports.resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ message: "Dados inválidos." });
    }

    // Procura usuário com esse token e onde a data de validade seja MAIOR que agora
    const query =
      "SELECT id FROM users WHERE reset_password_token = ? AND reset_password_expires > NOW()";
    const [users] = await db.execute(query, [token]);

    if (users.length === 0) {
      return res
        .status(400)
        .json({
          message: "O link é inválido ou já expirou. Solicite novamente.",
        });
    }

    const userId = users[0].id;

    // Criptografa a NOVA senha
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(newPassword, salt);

    // Atualiza a senha no banco e LIMPA o token para ele não ser usado de novo
    const updateQuery = `
            UPDATE users 
            SET password_hash = ?, reset_password_token = NULL, reset_password_expires = NULL 
            WHERE id = ?
        `;
    await db.execute(updateQuery, [hash, userId]);

    res.json({
      message: "Senha redefinida com sucesso! Você já pode fazer login.",
    });
  } catch (error) {
    console.error("Erro ao redefinir senha:", error);
    res.status(500).json({ error: "Erro interno", message: error.message });
  }
};
