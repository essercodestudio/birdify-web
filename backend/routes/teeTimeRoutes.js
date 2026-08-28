// backend/routes/teeTimeRoutes.js
const express = require("express");
const router = express.Router();
const c = require("../controllers/teeTimeController");
const { requireAuth, blockAdmin } = require("../middlewares/authMiddleware");

// Item 6 (2026-08-28): reservar e cancelar tee time são ações de jogador.
// GETs (config, availability, my-bookings) ficam requireAuth — permite admin
// consultar disponibilidade e listar reservas próprias (caso a conta admin
// já tenha reservas legadas), mas mutações são bloqueadas.
router.get("/config",         requireAuth, c.getPublicConfig);
router.get("/availability",   requireAuth, c.getAvailability);
router.post("/book",          blockAdmin,  c.book);
router.get("/my-bookings",    requireAuth, c.myBookings);
router.delete("/book/:id",    blockAdmin,  c.cancelOwnBooking);

module.exports = router;
