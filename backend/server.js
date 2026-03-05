// backend/server.js
const express = require('express');
const cors = require('cors');

// --- 1. IMPORTAÇÃO DAS ROTAS ---
const authRoutes = require('./routes/authRoutes');
const tournamentRoutes = require('./routes/tournamentRoutes');
const groupRoutes = require('./routes/groupRoutes');
const scoreRoutes = require('./routes/scoreRoutes');
const courseRoutes = require('./routes/courseRoutes');
const leaderboardRoutes = require('./routes/leaderboardRoutes'); // <--- A QUE FALTAVA
const exportRoutes = require('./routes/exportRoutes');
const inscriptionRoutes = require('./routes/inscriptionRoutes');

const app = express();

// --- 2. CONFIGURAÇÕES (Middleware) ---
app.use(cors());
app.use(express.json());

// --- 3. USO DAS ROTAS (Ligar os endereços aos arquivos) ---
app.use('/api/auth', authRoutes);
app.use('/api/tournaments', tournamentRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/scores', scoreRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/leaderboard', leaderboardRoutes); // <--- A LINHA MÁGICA QUE CORRIGE O ERRO 404
app.use('/api/export', exportRoutes);
app.use('/api/inscriptions', inscriptionRoutes);

// --- 4. INICIALIZAR O SERVIDOR ---
const PORT = 3001;
app.listen(PORT, () => {
    console.log(`✅ Servidor rodando na porta ${PORT}`);
    console.log(`📡 Rotas ativas:`);
    console.log(`   - /api/auth`);
    console.log(`   - /api/tournaments`);
    console.log(`   - /api/groups`);
    console.log(`   - /api/scores`);
    console.log(`   - /api/courses`);
    console.log(`   - /api/leaderboard`);
    console.log(`   - /api/export`);
});