// backend/routes/exportRoutes.js
const express = require('express');
const router = express.Router();
const exportController = require('../controllers/exportController');
const { requireAdmin } = require('../middlewares/authMiddleware');

// Export de resultados é ação do organizador — exige admin vinculado ao clube.
// O controller ainda revalida o club_id do torneio (defesa em profundidade).
router.get('/:tournamentId', requireAdmin, exportController.exportTournamentToExcel);

module.exports = router;
