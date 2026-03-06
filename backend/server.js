require('dotenv').config(); // Carrega as variáveis do arquivo .env
const express = require('express');
const cors = require('cors');

// --- 1. IMPORTAÇÃO DAS ROTAS ---
const authRoutes = require('./routes/authRoutes');
const tournamentRoutes = require('./routes/tournamentRoutes');
const groupRoutes = require('./routes/groupRoutes');
const scoreRoutes = require('./routes/scoreRoutes');
const courseRoutes = require('./routes/courseRoutes');
const leaderboardRoutes = require('./routes/leaderboardRoutes');
const exportRoutes = require('./routes/exportRoutes');
const inscriptionRoutes = require('./routes/inscriptionRoutes');

const app = express();

// --- 2. CONFIGURAÇÕES (Middleware) ---
app.use(cors());
app.use(express.json());

// --- 3. USO DAS ROTAS ---
app.use('/api/auth', authRoutes);
app.use('/api/tournaments', tournamentRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/scores', scoreRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/inscriptions', inscriptionRoutes);

// --- 4. INICIALIZAR O SERVIDOR ---
// Usa a porta da Hostinger ou a 3001 por padrão
const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
    console.log(`🚀 Birdify Engine rodando na porta ${PORT}`);
    console.log(`📡 Endpoints verificados e online.`);
});