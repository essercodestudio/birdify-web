const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/TrainingController');

router.post('/create',        ctrl.createTable);
router.post('/join',          ctrl.joinTable);
router.post('/leave',         ctrl.leaveGroup);
router.post('/cancel',        ctrl.deleteGroup);   // alias semântico para cancelar (criador)
router.post('/delete',        ctrl.deleteGroup);
router.get('/group/:groupId', ctrl.getTableDetails);
router.post('/score',         ctrl.saveScore);
router.get('/scores/:groupId',ctrl.getScores);
router.post('/start',         ctrl.startTraining);
router.post('/finish',        ctrl.finishTraining);
router.get('/current',        ctrl.getCurrentGroup);
router.get('/lobbies',        ctrl.getOpenLobbies);
router.get('/ranking/daily',  ctrl.getDailyRanking);
router.get('/scorecard/:groupId/:userId', ctrl.getTrainingScorecard);
router.get('/history/:userId',            ctrl.getPlayerHistory);

module.exports = router;
