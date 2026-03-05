// backend/routes/leaderboardRoutes.js
const express = require('express');
const router = express.Router();
const leaderboardController = require('../controllers/leaderboardController');

router.get('/:tournamentId', leaderboardController.getTournamentLeaderboard);
router.get('/details/:tournamentId/:userId', leaderboardController.getPlayerScorecard);

module.exports = router;