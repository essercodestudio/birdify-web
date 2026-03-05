// backend/routes/exportRoutes.js
const express = require('express');
const router = express.Router();
const exportController = require('../controllers/exportController');

// Espião na porta de entrada!
router.get('/:tournamentId', (req, res, next) => {
    console.log(`🚨 [ROTA EXPORT] Alguém clicou no botão Excel para o torneio ID: ${req.params.tournamentId}`);
    next();
}, exportController.exportTournamentToExcel);

module.exports = router;