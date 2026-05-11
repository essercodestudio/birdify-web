// backend/routes/tournamentRoutes.js
const express = require('express');
const router = express.Router();
const tournamentController = require('../controllers/tournamentController');
const { requireAuth } = require('../middlewares/authMiddleware');

router.get('/list', tournamentController.listTournaments);
router.get('/:id', tournamentController.getTournament);
router.post('/create',       requireAuth, tournamentController.createTournament);
router.delete('/delete/:id', requireAuth, tournamentController.deleteTournament);
router.put('/update/:id',    requireAuth, tournamentController.updateTournament);
router.put('/status/:id',    requireAuth, tournamentController.toggleStatus);

module.exports = router;
