// backend/routes/scoreRoutes.js
const express = require('express');
const router = express.Router();
const scoreController = require('../controllers/scoreController');
const { requireAuth, blockAdmin } = require('../middlewares/authMiddleware');

// /list era publico — subido pra requireAuth em 2026-08-27 (usado por
// Scorecard.js, tela sob ProtectedRoute). Nao vaza cross-tenant porque o
// controller filtra por req.club.id, mas nao ha caso de uso valido pra
// consumir anonimamente.
//
// Item 6 (2026-08-28): marcar score e assinar cartão são fluxo de jogador
// (admin ajusta score pelo /admin/scores/... com auditoria). blockAdmin
// fecha essas duas mutações; GETs permanecem requireAuth pra permitir
// leitura por admin em auditoria.
router.post('/save',             blockAdmin, scoreController.saveScore);
router.get('/list/:tournamentId', requireAuth, scoreController.getScores);
router.post('/sign-card',        blockAdmin, scoreController.signCard);
router.get('/signature/:groupId', requireAuth, scoreController.getSignature);

module.exports = router;
