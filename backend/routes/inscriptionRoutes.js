// backend/routes/inscriptionRoutes.js
//
// Isolamento multi-tenant (2026-08-27):
// - /list e /update-status são exclusivos do TournamentManager (admin) →
//   requireAdmin (dupla checagem: role + vínculo em club_admins).
// - /tournament/:id (detalhes com estado da inscrição do próprio user) e
//   /create (inscrever-se num torneio) são fluxo de jogador → requireAuth.
const express = require('express');
const router = express.Router();
const inscriptionController = require('../controllers/inscriptionController');
const { requireAuth, requireAdmin } = require('../middlewares/authMiddleware');

router.get('/tournament/:id',    requireAuth,  inscriptionController.getTournamentDetails);
router.post('/create',           requireAuth,  inscriptionController.createInscription);
router.get('/list/:tournamentId', requireAdmin, inscriptionController.getInscriptions);
router.put('/update-status/:id', requireAdmin, inscriptionController.updateStatus);

module.exports = router;
