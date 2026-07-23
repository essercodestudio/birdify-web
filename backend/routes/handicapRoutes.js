// backend/routes/handicapRoutes.js
const express = require("express");
const router = express.Router();
const c = require("../controllers/handicapController");
const { requireAuth } = require("../middlewares/authMiddleware");

router.get("/me",                     requireAuth, c.getMyHandicap);
router.get("/course-handicap",        requireAuth, c.getCourseHandicap);
router.post("/recalculate-mine",      requireAuth, c.recalculateMine);

module.exports = router;
