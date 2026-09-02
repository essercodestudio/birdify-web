// backend/routes/leaderboardRoutes.js
const express = require('express');
const router = express.Router();
const leaderboardController = require('../controllers/leaderboardController');

router.get('/:tournamentId', leaderboardController.getTournamentLeaderboard);
router.get('/details/:tournamentId/:userId', leaderboardController.getPlayerScorecard);
// Onda B · Commit 3.6: scorecard da dupla em torneio doubles.
router.get('/details-dupla/:tournamentId/:duplaId', leaderboardController.getDuplaScorecard);

module.exports = router;