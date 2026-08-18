// backend/routes/adminRoutes.js
const express = require("express");
const router = express.Router();
const adminController = require("../controllers/adminController");
const teeController = require("../controllers/teeTimeController");
const scoreEditor = require("../controllers/adminScoreController");
const { requireAdmin } = require("../middlewares/authMiddleware");

router.get("/dashboard", requireAdmin, adminController.getDashboardKPIs);
router.get("/club", requireAdmin, adminController.getClub);
router.put("/club", requireAdmin, adminController.updateClub);
router.get("/onboarding", requireAdmin, adminController.getOnboardingChecklist);

// Tee Times — admin
router.get("/tee-settings",           requireAdmin, teeController.getSettings);
router.put("/tee-settings",           requireAdmin, teeController.updateSettings);
router.get("/tee-bookings",           requireAdmin, teeController.listAllBookings);
router.put("/tee-bookings/:id/status", requireAdmin, teeController.updateBookingStatus);

// Ajuste manual de scores (torneio e treino)
router.get("/scores/tournaments",                      requireAdmin, scoreEditor.listTournaments);
router.get("/scores/tournament/:tournamentId",         requireAdmin, scoreEditor.getTournamentMatrix);
router.put("/scores/tournament",                       requireAdmin, scoreEditor.upsertTournamentScore);
router.get("/scores/trainings",                        requireAdmin, scoreEditor.listTrainings);
router.get("/scores/training/:groupId",                requireAdmin, scoreEditor.getTrainingMatrix);
router.put("/scores/training",                         requireAdmin, scoreEditor.upsertTrainingScore);
router.get("/scores/audit",                            requireAdmin, scoreEditor.listAudit);

module.exports = router;
