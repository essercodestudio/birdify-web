// backend/routes/adminRoutes.js
const express = require("express");
const router = express.Router();
const adminController = require("../controllers/adminController");
const teeController = require("../controllers/teeTimeController");
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

module.exports = router;
