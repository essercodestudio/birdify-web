// backend/routes/scoreRoutes.js
const express = require('express');
const router = express.Router();
const scoreController = require('../controllers/scoreController');
const { requireAuth } = require('../middlewares/authMiddleware');

router.post('/save', requireAuth, scoreController.saveScore);
router.get('/list/:tournamentId', scoreController.getScores);

module.exports = router;
