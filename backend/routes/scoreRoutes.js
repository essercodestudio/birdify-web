// backend/routes/scoreRoutes.js
const express = require('express');
const router = express.Router();
const scoreController = require('../controllers/scoreController');
const { requireAuth } = require('../middlewares/authMiddleware');

// /list era publico — subido pra requireAuth em 2026-08-27 (usado por
// Scorecard.js, tela sob ProtectedRoute). Nao vaza cross-tenant porque o
// controller filtra por req.club.id, mas nao ha caso de uso valido pra
// consumir anonimamente.
router.post('/save',             requireAuth, scoreController.saveScore);
router.get('/list/:tournamentId', requireAuth, scoreController.getScores);
router.post('/sign-card',        requireAuth, scoreController.signCard);
router.get('/signature/:groupId', requireAuth, scoreController.getSignature);

module.exports = router;
