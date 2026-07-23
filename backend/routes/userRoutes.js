// backend/routes/userRoutes.js
// Perfil do jogador — todas as rotas exigem autenticação; o upload da foto
// fica em server.js (junto do multer, mesmo padrão do upload de sponsors).
const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middlewares/authMiddleware");
const { getMyProfile, updateMyProfile } = require("../controllers/userController");

router.get("/me/profile", requireAuth, getMyProfile);
router.put("/me/profile", requireAuth, updateMyProfile);

module.exports = router;
