const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/TrainingController');
const { requireAuth } = require('../middlewares/authMiddleware');

// Hardening 2026-08-27: GETs de fluxo de jogador subidos pra requireAuth
// (todas as telas consumidoras — DailyTraining, TrainingScorecard,
// PlayerHistory — estao sob ProtectedRoute). O /ranking/daily/public
// segue publico pra TrainingRankingPublic (rota /treino/:id/ranking sem
// login); /ranking/daily (versao logada com categorias, usada pela
// TrainingLeaderboard) continua sem middleware pra nao quebrar essa tela
// que hoje nao usa ProtectedRoute — vira TODO reavaliar.
router.post('/create',        requireAuth, ctrl.createTable);
router.post('/join',          requireAuth, ctrl.joinTable);
router.post('/leave',         requireAuth, ctrl.leaveGroup);
router.post('/cancel',        requireAuth, ctrl.deleteGroup);
router.post('/delete',        requireAuth, ctrl.deleteGroup);
router.get('/group/:groupId', requireAuth, ctrl.getTableDetails);
router.post('/score',         requireAuth, ctrl.saveScore);
router.get('/scores/:groupId', requireAuth, ctrl.getScores);
router.post('/save-handicaps', requireAuth, ctrl.saveHandicaps);
router.post('/start',         requireAuth, ctrl.startTraining);
router.post('/finish',        requireAuth, ctrl.finishTraining);
router.get('/current',        requireAuth, ctrl.getCurrentGroup);
router.get('/lobbies',        requireAuth, ctrl.getOpenLobbies);
router.get('/ranking/daily/public', ctrl.getDailyRankingPublic);
router.get('/ranking/daily',  ctrl.getDailyRanking);
router.get('/scorecard/:groupId/:userId', requireAuth, ctrl.getTrainingScorecard);
router.get('/history/:userId', requireAuth, ctrl.getPlayerHistory);

module.exports = router;
