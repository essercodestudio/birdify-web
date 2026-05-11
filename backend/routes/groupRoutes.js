// backend/routes/groupRoutes.js
const express = require("express");
const router = express.Router();
const groupController = require("../controllers/groupController");
const { requireAuth } = require("../middlewares/authMiddleware");

router.get('/export/:tournamentId',              groupController.exportGroupsToExcel);
router.get("/list/:tournamentId",                groupController.getGroupsByTournament);
router.post("/create",          requireAuth,     groupController.createGroup);
router.post("/add-player",      requireAuth,     groupController.addPlayerToGroup);
router.delete('/remove-player/:groupId/:userId', requireAuth, groupController.removePlayer);
router.delete("/delete/:id",    requireAuth,     groupController.deleteGroup);
router.post("/generate-code",   requireAuth,     groupController.generateCode);
router.post('/join',            requireAuth,     groupController.joinGroup);
router.put("/save-handicaps",   requireAuth,     groupController.saveGroupHandicaps);

module.exports = router;
