// backend/routes/groupRoutes.js
const express = require("express");
const router = express.Router();
const groupController = require("../controllers/groupController");

// Rotas antigas que já funcionam
router.get('/export/:tournamentId', groupController.exportGroupsToExcel);
router.post("/create", groupController.createGroup);
router.get("/list/:tournamentId", groupController.getGroupsByTournament);
router.post("/add-player", groupController.addPlayerToGroup);
router.delete('/remove-player/:groupId/:userId', groupController.removePlayer);
router.delete("/delete/:id", groupController.deleteGroup);
router.post("/generate-code", groupController.generateCode);
router.post('/join', groupController.joinGroup);

// A ROTA NOVA QUE ESTAVA FALTANDO (A culpada do erro 404):
router.put("/save-handicaps", groupController.saveGroupHandicaps);

module.exports = router;
