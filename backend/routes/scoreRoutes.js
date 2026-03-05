// backend/routes/scoreRoutes.js
const express = require('express');
const router = express.Router();
const scoreController = require('../controllers/scoreController');

// Rota para salvar (ou atualizar) a nota de um buraco
router.post('/save', scoreController.saveScore);

// Rota para buscar todas as notas do torneio (para preencher o cartão quando abrir)
router.get('/list/:tournamentId', scoreController.getScores);

module.exports = router;