// backend/routes/tournamentRoutes.js
//
// Isolamento multi-tenant: TODAS as rotas passam por requireAuth ou requireAdmin.
// Antes de 2026-08-27, GETs eram públicos e mutações usavam apenas requireAuth,
// permitindo (a) enumeração anônima de torneios de qualquer clube por curl e
// (b) qualquer user logado — inclusive admin de OUTRO clube — criar/editar/
// deletar torneios do clube do domínio atual. O requireAdmin do
// authMiddleware faz dupla checagem (role ADMIN + linha em club_admins
// bindada ao req.club.id do Detetive de Domínios), fechando a lacuna.
const express = require('express');
const router = express.Router();
const tournamentController = require('../controllers/tournamentController');
const { requireAuth, requireAdmin } = require('../middlewares/authMiddleware');

// Leitura — qualquer jogador logado do clube atual (usado por PlayerHome,
// PlayerDashboard, Dashboard admin, CircuitManagement pra montar lista de
// stages). Filtragem por req.club.id acontece no controller.
router.get('/list', requireAuth, tournamentController.listTournaments);
router.get('/:id',  requireAuth, tournamentController.getTournament);

// Mutações — só admin do clube atual. requireAdmin bloqueia:
// - user sem role ADMIN → 403
// - admin de outro clube (sem vínculo em club_admins com req.club.id) → 403
router.post('/create',       requireAdmin, tournamentController.createTournament);
router.delete('/delete/:id', requireAdmin, tournamentController.deleteTournament);
router.put('/update/:id',    requireAdmin, tournamentController.updateTournament);
router.put('/status/:id',    requireAdmin, tournamentController.toggleStatus);

module.exports = router;
