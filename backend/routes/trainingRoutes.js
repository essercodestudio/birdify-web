const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/TrainingController');
const { requireAuth } = require('../middlewares/authMiddleware');

router.post('/create',        requireAuth, ctrl.createTable);
router.post('/join',          requireAuth, ctrl.joinTable);
router.post('/leave',         requireAuth, ctrl.leaveGroup);
router.post('/cancel',        requireAuth, ctrl.deleteGroup);
router.post('/delete',        requireAuth, ctrl.deleteGroup);
router.get('/group/:groupId', ctrl.getTableDetails);
router.post('/score',         requireAuth, ctrl.saveScore);
router.get('/scores/:groupId',ctrl.getScores);
router.post('/start',         requireAuth, ctrl.startTraining);
router.post('/finish',        requireAuth, ctrl.finishTraining);
router.get('/current',        ctrl.getCurrentGroup);
router.get('/lobbies',        ctrl.getOpenLobbies);
router.get('/ranking/daily',  ctrl.getDailyRanking);
router.get('/scorecard/:groupId/:userId', ctrl.getTrainingScorecard);
router.get('/history/:userId',            ctrl.getPlayerHistory);

module.exports = router;
