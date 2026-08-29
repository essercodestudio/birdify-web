// backend/routes/groupRoutes.js
const express = require("express");
const router = express.Router();
const groupController = require("../controllers/groupController");
const { requireAuth, requireAdmin, blockAdmin } = require("../middlewares/authMiddleware");

// Isolamento multi-tenant (2026-08-27): gestão do TournamentManager
// (create/auto-generate/add-player/remove-player/delete/generate-code/PUT :id)
// é exclusiva do admin do clube do torneio → requireAdmin.
// join e save-handicaps são fluxo de jogador (entra com código, declara HC) →
// blockAdmin (Item 6 2026-08-28: conta admin não executa ação de jogador).
// /list é semi-público dentro do clube (usado por scorecard/join screens tanto
// do admin quanto do próprio player) → requireAuth.
router.get('/export/:tournamentId',              requireAdmin, groupController.exportGroupsToExcel);
router.get("/list/:tournamentId",                requireAuth,  groupController.getGroupsByTournament);
router.post("/create",          requireAdmin,    groupController.createGroup);
router.post("/auto-generate",   requireAdmin,    groupController.autoGenerateGroups);
// Bloco D · commit 3: re-seeding automatico pela classificacao de R(N-1).
// Rota separada de /auto-generate pra deixar explicito que o comportamento
// e diferente (usa scores existentes em vez de shuffle aleatorio).
router.post("/generate-from-standings", requireAdmin, groupController.generateFromStandings);
router.post("/add-player",      requireAdmin,    groupController.addPlayerToGroup);
router.delete('/remove-player/:groupId/:userId', requireAdmin, groupController.removePlayer);
router.delete("/delete/:id",    requireAdmin,    groupController.deleteGroup);
router.post("/generate-code",   requireAdmin,    groupController.generateCode);
router.post('/join',            blockAdmin,      groupController.joinGroup);
router.put("/save-handicaps",   blockAdmin,      groupController.saveGroupHandicaps);
// PUT /:id é catch-all — precisa vir DEPOIS de todas as rotas com paths literais
// (senão engoliria /save-handicaps tratando "save-handicaps" como id de grupo).
router.put("/:id",              requireAdmin,    groupController.updateGroup);

module.exports = router;
