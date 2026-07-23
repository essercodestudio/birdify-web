// backend/routes/adminRoutes.js
const express = require("express");
const router = express.Router();
const adminController = require("../controllers/adminController");
const teeController = require("../controllers/teeTimeController");
const handicapController = require("../controllers/handicapController");
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

// Handicap WHS — admin
router.get("/course-tees/:courseId",   requireAdmin, handicapController.listCourseTees);
router.put("/course-tees/:courseId",   requireAdmin, handicapController.saveCourseTees);
router.delete("/course-tees/tee/:id",  requireAdmin, handicapController.deleteCourseTee);
router.get("/handicap/list",           requireAdmin, handicapController.listAllHandicaps);
router.post("/handicap/recalculate-all", requireAdmin, handicapController.recalculateAll);

module.exports = router;
