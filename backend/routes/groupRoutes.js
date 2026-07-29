// backend/routes/groupRoutes.js
const express = require("express");
const router = express.Router();
const groupController = require("../controllers/groupController");
const { requireAuth, requireAdmin } = require("../middlewares/authMiddleware");

router.get('/export/:tournamentId',              requireAdmin, groupController.exportGroupsToExcel);
router.get("/list/:tournamentId",                groupController.getGroupsByTournament);
router.post("/create",          requireAuth,     groupController.createGroup);
router.post("/auto-generate",   requireAuth,     groupController.autoGenerateGroups);
router.post("/add-player",      requireAuth,     groupController.addPlayerToGroup);
router.delete('/remove-player/:groupId/:userId', requireAuth, groupController.removePlayer);
router.delete("/delete/:id",    requireAuth,     groupController.deleteGroup);
router.post("/generate-code",   requireAuth,     groupController.generateCode);
router.post('/join',            requireAuth,     groupController.joinGroup);
router.put("/save-handicaps",   requireAuth,     groupController.saveGroupHandicaps);
// PUT /:id é catch-all — precisa vir DEPOIS de todas as rotas com paths literais
// (senão engoliria /save-handicaps tratando "save-handicaps" como id de grupo).
router.put("/:id",              requireAuth,     groupController.updateGroup);

module.exports = router;
