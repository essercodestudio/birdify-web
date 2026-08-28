const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/TrainingController');
const { requireAuth, blockAdmin } = require('../middlewares/authMiddleware');

// Hardening 2026-08-27: GETs de fluxo de jogador subidos pra requireAuth
// (todas as telas consumidoras — DailyTraining, TrainingScorecard,
// PlayerHistory — estao sob ProtectedRoute). O /ranking/daily/public
// segue publico pra TrainingRankingPublic (rota /treino/:id/ranking sem
// login); /ranking/daily (versao logada com categorias, usada pela
// TrainingLeaderboard) continua sem middleware pra nao quebrar essa tela
// que hoje nao usa ProtectedRoute — vira TODO reavaliar.
//
// Item 6 (2026-08-28): mutações agora usam blockAdmin em vez de requireAuth.
// Regra: conta com role=ADMIN nunca marca score, cria/entra/cancela treino,
// nem declara handicap — essas são funções de jogador. GETs continuam com
// requireAuth (admin pode ler pra auditoria/gerência).
router.post('/create',        blockAdmin, ctrl.createTable);
router.post('/join',          blockAdmin, ctrl.joinTable);
router.post('/leave',         blockAdmin, ctrl.leaveGroup);
router.post('/cancel',        blockAdmin, ctrl.deleteGroup);
router.post('/delete',        blockAdmin, ctrl.deleteGroup);
router.get('/group/:groupId', requireAuth, ctrl.getTableDetails);
router.post('/score',         blockAdmin, ctrl.saveScore);
router.get('/scores/:groupId', requireAuth, ctrl.getScores);
router.post('/save-handicaps', blockAdmin, ctrl.saveHandicaps);
router.post('/start',         blockAdmin, ctrl.startTraining);
router.post('/finish',        blockAdmin, ctrl.finishTraining);
router.get('/current',        requireAuth, ctrl.getCurrentGroup);
router.get('/lobbies',        requireAuth, ctrl.getOpenLobbies);
router.get('/ranking/daily/public', ctrl.getDailyRankingPublic);
router.get('/ranking/daily',  ctrl.getDailyRanking);
router.get('/scorecard/:groupId/:userId', requireAuth, ctrl.getTrainingScorecard);
router.get('/history/:userId', requireAuth, ctrl.getPlayerHistory);

module.exports = router;
