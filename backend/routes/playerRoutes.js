const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/playerController");
const { requireAuth } = require("../middlewares/authMiddleware");

// Análise de desempenho do jogador logado — user_id sai do JWT, club_id do middleware.
router.get("/me/performance", requireAuth, ctrl.getMyPerformance);

module.exports = router;
