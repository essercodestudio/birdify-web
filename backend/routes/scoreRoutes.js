// backend/routes/scoreRoutes.js
const express = require('express');
const router = express.Router();
const scoreController = require('../controllers/scoreController');
const { requireAuth } = require('../middlewares/authMiddleware');

router.post('/save', requireAuth, scoreController.saveScore);
router.get('/list/:tournamentId', scoreController.getScores);
router.post('/sign-card', requireAuth, scoreController.signCard);
router.get('/signature/:groupId', requireAuth, scoreController.getSignature);

module.exports = router;
