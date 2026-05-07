require("dotenv").config();
const http    = require("http");
const express = require("express");
const { Server } = require("socket.io");
const cors    = require("cors");
const morgan  = require("morgan");
const db      = require("./db");

const { initCronJobs }   = require("./services/cronService");
const socketService      = require("./services/socketService");

const authRoutes         = require("./routes/authRoutes");
const tournamentRoutes   = require("./routes/tournamentRoutes");
const groupRoutes        = require("./routes/groupRoutes");
const scoreRoutes        = require("./routes/scoreRoutes");
const courseRoutes       = require("./routes/courseRoutes");
const leaderboardRoutes  = require("./routes/leaderboardRoutes");
const exportRoutes       = require("./routes/exportRoutes");
const inscriptionRoutes  = require("./routes/inscriptionRoutes");
const trainingRoutes     = require("./routes/trainingRoutes");

const app    = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

socketService.setIo(io);

io.on("connection", (socket) => {
  socket.on("join:training", (groupId) => {
    socket.join(`training:${groupId}`);
  });
  socket.on("leave:training", (groupId) => {
    socket.leave(`training:${groupId}`);
  });
  socket.on("join:ranking", () => {
    socket.join("training:ranking");
  });
});

app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

// Detetive de Domínios — multi-clubes
app.use(async (req, res, next) => {
  try {
    let domain = req.hostname;
    if (req.headers.origin) {
      const url = new URL(req.headers.origin);
      domain = url.hostname;
    }
    if (domain === "127.0.0.1") domain = "localhost";
    const [clubs] = await db.query("SELECT * FROM clubs WHERE domain = ?", [domain]);
    req.club = clubs.length > 0
      ? clubs[0]
      : { id: 1, name: "Birdify Padrão", primary_color: "#22c55e", logo_url: "" };
    next();
  } catch (error) {
    console.error("🕵️ Erro no Detetive de Domínios:", error);
    req.club = { id: 1, name: "Birdify Erro", primary_color: "#22c55e" };
    next();
  }
});

app.use("/api/auth",         authRoutes);
app.use("/api/tournaments",  tournamentRoutes);
app.use("/api/groups",       groupRoutes);
app.use("/api/scores",       scoreRoutes);
app.use("/api/courses",      courseRoutes);
app.use("/api/leaderboard",  leaderboardRoutes);
app.use("/api/export",       exportRoutes);
app.use("/api/inscriptions", inscriptionRoutes);
app.use("/api/training",     trainingRoutes);

app.get("/api/theme", (req, res) => {
  res.json({
    id:            req.club.id,
    name:          req.club.name,
    domain:        req.club.domain,
    primary_color: req.club.primary_color,
    logo_url:      req.club.logo_url,
    sport_type:    req.club.sport_type || "golf",
  });
});

initCronJobs();

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Birdify Engine rodando na porta ${PORT}`);
  console.log(`🔌 Socket.io ativo — tempo real habilitado`);
  console.log(`🕵️  Detetive Multi-Clubes ativado.`);
  console.log(`⏰ Despertador da meia-noite (Cron) ativado!`);
});
