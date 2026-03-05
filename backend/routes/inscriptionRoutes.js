// backend/routes/inscriptionRoutes.js
const express = require('express');
const router = express.Router();
const inscriptionController = require('../controllers/inscriptionController');

router.get('/tournament/:id', inscriptionController.getTournamentDetails);
router.post('/create', inscriptionController.createInscription);
router.get('/list/:tournamentId', inscriptionController.getInscriptions);
router.put('/update-status/:id', inscriptionController.updateStatus);

module.exports = router;