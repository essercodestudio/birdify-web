process.env.TZ = "America/Sao_Paulo";

require("dotenv").config();
const http   = require("http");
const path   = require("path");
const fs     = require("fs");
const express = require("express");
const { Server } = require("socket.io");
const cors   = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const multer = require("multer");
const db = require("./db");

const rateLimit = require("express-rate-limit");
const { initCronJobs } = require("./services/cronService");
const socketService = require("./services/socketService");
const { requireAdmin, requireAuth } = require("./middlewares/authMiddleware");

const authRoutes = require("./routes/authRoutes");
const tournamentRoutes = require("./routes/tournamentRoutes");
const groupRoutes = require("./routes/groupRoutes");
const scoreRoutes = require("./routes/scoreRoutes");
const courseRoutes = require("./routes/courseRoutes");
const leaderboardRoutes = require("./routes/leaderboardRoutes");
const exportRoutes = require("./routes/exportRoutes");
const inscriptionRoutes = require("./routes/inscriptionRoutes");
const trainingRoutes = require("./routes/trainingRoutes");
const circuitRoutes = require("./routes/circuitRoutes");
const adminRoutes = require("./routes/adminRoutes");
const teeTimeRoutes = require("./routes/teeTimeRoutes");
const userRoutes = require("./routes/userRoutes");
const playerRoutes = require("./routes/playerRoutes");
const { saveMyPhoto } = require("./controllers/userController");

const app = express();
const server = http.createServer(app);

// Aceita lista separada por vírgula (FRONTEND_URLS) para suportar
// staging + produção + previews simultaneamente. Mantém compatibilidade
// com FRONTEND_URL (singular) já usado em produção.
const ALLOWED_ORIGINS = (process.env.FRONTEND_URLS || process.env.FRONTEND_URL || "https://birdify.com.br")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const corsOriginCheck = (origin, callback) => {
  // Requisições sem Origin (curl, healthcheck, mesmo host) são permitidas.
  if (!origin) return callback(null, true);
  if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
  return callback(new Error(`Origem não autorizada: ${origin}`));
};

const io = new Server(server, {
  cors: { origin: ALLOWED_ORIGINS, methods: ["GET", "POST"] },
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

// ─── Upload de logos de patrocinadores ────────────────────────────────────────
const sponsorUploadsDir = path.join(__dirname, "public", "uploads", "sponsors");
fs.mkdirSync(sponsorUploadsDir, { recursive: true });

const sponsorUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, sponsorUploadsDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  }),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    /^image\//.test(file.mimetype)
      ? cb(null, true)
      : cb(new Error("Apenas imagens são permitidas.")),
});

// ─── Upload de foto de perfil do jogador (mesmo padrão dos sponsors) ─────────
const avatarUploadsDir = path.join(__dirname, "public", "uploads", "avatars");
fs.mkdirSync(avatarUploadsDir, { recursive: true });

const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, avatarUploadsDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  }),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    /^image\//.test(file.mimetype)
      ? cb(null, true)
      : cb(new Error("Apenas imagens são permitidas.")),
});

// Helmet como primeiro middleware — protege contra vulnerabilidades HTTP comuns.
// crossOriginResourcePolicy: false libera as imagens dos patrocinadores
// (/public/uploads) caso frontend e backend compartilhem domínio.
app.use(helmet({ crossOriginResourcePolicy: false }));

app.use(cors({ origin: corsOriginCheck, credentials: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json({ limit: "50kb" }));

// Logger de requisições apenas fora de produção — console limpo no servidor.
if (process.env.NODE_ENV !== "production") {
  app.use(morgan("dev"));
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Muitas tentativas. Aguarde 15 minutos e tente novamente.",
  },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Limite de cadastros atingido. Tente novamente em 1 hora.",
  },
});

// Detetive de Domínios — multi-clubes
app.use(async (req, res, next) => {
  try {
    let domain = req.hostname;
    if (req.headers.origin) {
      const url = new URL(req.headers.origin);
      domain = url.hostname;
    }
    if (domain === "127.0.0.1") domain = "localhost";
    const [clubs] = await db.query("SELECT * FROM clubs WHERE domain = ?", [
      domain,
    ]);
    req.club =
      clubs.length > 0
        ? clubs[0]
        : {
            id: 1,
            name: "Birdify Padrão",
            primary_color: "#22c55e",
            logo_url: "",
          };
    next();
  } catch (error) {
    console.error("🕵️ Erro no Detetive de Domínios:", error);
    req.club = { id: 1, name: "Birdify Erro", primary_color: "#22c55e" };
    next();
  }
});

app.use("/api/auth/login", loginLimiter);
app.use("/api/auth/register", registerLimiter);
app.use("/api/auth", authRoutes);
app.use("/api/tournaments", tournamentRoutes);
app.use("/api/groups", groupRoutes);
app.use("/api/scores", scoreRoutes);
app.use("/api/courses", courseRoutes);
app.use("/api/leaderboard", leaderboardRoutes);
app.use("/api/export", exportRoutes);
app.use("/api/inscriptions", inscriptionRoutes);
app.use("/api/training", trainingRoutes);
app.use("/api/circuits", circuitRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/tee-times", teeTimeRoutes);
app.use("/api/users", userRoutes);
app.use("/api/players", playerRoutes);

// Upload da foto de perfil — requireAuth (qualquer usuário logado, só a própria foto)
app.post(
  "/api/users/me/photo",
  requireAuth,
  avatarUpload.single("photo"),
  saveMyPhoto
);

app.post(
  "/api/sponsors/upload",
  requireAdmin,
  sponsorUpload.single("logo"),
  (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Nenhum arquivo enviado." });
    res.json({ url: `/uploads/sponsors/${req.file.filename}` });
  }
);

app.get("/api/theme", (req, res) => {
  res.json({
    id: req.club.id,
    name: req.club.name,
    domain: req.club.domain,
    primary_color: req.club.primary_color,
    logo_url: req.club.logo_url,
  });
});

app.use((err, req, res, next) => {
  console.error("💥 Erro não tratado:", err);
  res.status(500).json({ error: "Erro interno no servidor." });
});

initCronJobs();

process.on("uncaughtException", (err) => {
  console.error("💥 uncaughtException:", err.message, err.stack);
});

process.on("unhandledRejection", (reason) => {
  console.error("💥 unhandledRejection:", reason);
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Birdify Engine rodando na porta ${PORT}`);
  console.log(`🔌 Socket.io ativo — tempo real habilitado`);
  console.log(`🕵️  Detetive Multi-Clubes ativado.`);
  console.log(`⏰ Despertador da meia-noite (Cron) ativado!`);
});
