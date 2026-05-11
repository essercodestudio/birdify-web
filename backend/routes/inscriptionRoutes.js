// backend/routes/inscriptionRoutes.js
const express = require('express');
const router = express.Router();
const inscriptionController = require('../controllers/inscriptionController');
const { requireAuth } = require('../middlewares/authMiddleware');

router.get('/tournament/:id',       inscriptionController.getTournamentDetails);
router.post('/create',    requireAuth, inscriptionController.createInscription);
router.get('/list/:tournamentId',   inscriptionController.getInscriptions);
router.put('/update-status/:id', requireAuth, inscriptionController.updateStatus);

module.exports = router;
