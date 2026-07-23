// backend/routes/teeTimeRoutes.js
const express = require("express");
const router = express.Router();
const c = require("../controllers/teeTimeController");
const { requireAuth } = require("../middlewares/authMiddleware");

// Todas as rotas do sócio precisam apenas de auth
router.get("/config",         requireAuth, c.getPublicConfig);
router.get("/availability",   requireAuth, c.getAvailability);
router.post("/book",          requireAuth, c.book);
router.get("/my-bookings",    requireAuth, c.myBookings);
router.delete("/book/:id",    requireAuth, c.cancelOwnBooking);

module.exports = router;
