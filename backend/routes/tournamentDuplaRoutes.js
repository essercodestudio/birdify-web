// backend/routes/tournamentDuplaRoutes.js
//
// Onda B · Bloco 3 · Commit 3.2. Rotas de CRUD de duplas em torneios
// doubles. TODAS requireAdmin — cadastro/edição/deleção de dupla é
// exclusivo do painel. Jogador não cria dupla (decisão 1 da Onda B).
const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/tournamentDuplaController");
const { requireAdmin } = require("../middlewares/authMiddleware");

router.get("/tournament/:tournamentId", requireAdmin, ctrl.listDuplas);
router.post("/", requireAdmin, ctrl.createDupla);
router.put("/:id", requireAdmin, ctrl.updateDupla);
router.delete("/:id", requireAdmin, ctrl.deleteDupla);
router.post("/:id/players", requireAdmin, ctrl.addPlayer);
router.delete("/:id/players/:userId", requireAdmin, ctrl.removePlayer);

module.exports = router;
