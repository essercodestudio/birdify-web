require("dotenv").config(); // Carrega as variáveis do arquivo .env
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const db = require("./db"); // Importando a conexão com o banco

// --- IMPORTAÇÃO DO SERVIÇO DE CRON (O Despertador) ---
const { initCronJobs } = require("./services/cronService");

// --- 1. IMPORTAÇÃO DAS ROTAS ---
const authRoutes = require("./routes/authRoutes");
const tournamentRoutes = require("./routes/tournamentRoutes");
const groupRoutes = require("./routes/groupRoutes");
const scoreRoutes = require("./routes/scoreRoutes");
const courseRoutes = require("./routes/courseRoutes");
const leaderboardRoutes = require("./routes/leaderboardRoutes");
const exportRoutes = require("./routes/exportRoutes");
const inscriptionRoutes = require("./routes/inscriptionRoutes");
const trainingRoutes = require('./routes/trainingRoutes');

const app = express();

// --- 2. CONFIGURAÇÕES (Middleware) ---
app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

// --- 2.5 DETETIVE DE DOMÍNIOS (O Porteiro Multi-Clubes) ---
app.use(async (req, res, next) => {
  try {
    // 1. Tenta descobrir de qual domínio a requisição está vindo
    let domain = req.hostname;

    // Se o frontend chamou a API, a origem verdadeira vem no header 'origin'
    if (req.headers.origin) {
      const url = new URL(req.headers.origin);
      domain = url.hostname;
    }

    // Ajuste para testes locais
    if (domain === "127.0.0.1") domain = "localhost";

    // 2. Procura o clube dono desse domínio no Banco de Dados
    const [clubs] = await db.query("SELECT * FROM clubs WHERE domain = ?", [
      domain,
    ]);

    // 3. Etiqueta a requisição com os dados do clube!
    if (clubs.length > 0) {
      req.club = clubs[0];
    } else {
      // Se acessar por um domínio desconhecido, cai no Birdify Padrão (id: 1)
      req.club = {
        id: 1,
        name: "Birdify Padrão",
        primary_color: "#22c55e",
        logo_url: "",
      };
    }

    next(); // Libera a catraca para as rotas abaixo
  } catch (error) {
    console.error("🕵️ Erro no Detetive de Domínios:", error);
    req.club = { id: 1, name: "Birdify Erro", primary_color: "#22c55e" };
    next();
  }
});

// --- 3. USO DAS ROTAS ---
app.use("/api/auth", authRoutes);
app.use("/api/tournaments", tournamentRoutes);
app.use("/api/groups", groupRoutes);
app.use("/api/scores", scoreRoutes);
app.use("/api/courses", courseRoutes);
app.use("/api/leaderboard", leaderboardRoutes);
app.use("/api/export", exportRoutes);
app.use("/api/inscriptions", inscriptionRoutes);
app.use('/api/training', trainingRoutes);

// --- 3.5 ROTA DO CAMALEÃO (TEMA DINÂMICO) ---
// O React chama isso para saber qual cor e logo usar
app.get("/api/theme", (req, res) => {
  // O middleware lá de cima já deixou o req.club pronto com os dados do banco
  res.json({
    id:            req.club.id,
    name:          req.club.name,
    domain:        req.club.domain,
    primary_color: req.club.primary_color,
    logo_url:      req.club.logo_url,
    sport_type:    req.club.sport_type || 'golf', // 'golf' | 'footgolf'
  });
});

// --- 4. LIGAR O DESPERTADOR AUTOMÁTICO ---
initCronJobs();

// --- 5. INICIALIZAR O SERVIDOR ---
const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`🚀 Birdify Engine rodando na porta ${PORT}`);
  console.log(`🕵️  Detetive Multi-Clubes ativado e espionando domínios.`);
  console.log(`⏰ Despertador da meia-noite (Cron) ativado!`);
  console.log(`🎨 Rota de temas (/api/theme) online.`);
});
