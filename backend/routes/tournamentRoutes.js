// backend/routes/tournamentRoutes.js
const express = require('express');
const router = express.Router();
const tournamentController = require('../controllers/tournamentController');

router.get('/list', tournamentController.listTournaments);
router.get('/:id', tournamentController.getTournament);
router.post('/create', tournamentController.createTournament);
router.delete('/delete/:id', tournamentController.deleteTournament);

// 👉 A ROTA QUE ESTAVA FALTANDO PARA A EDIÇÃO FUNCIONAR:
router.put('/update/:id', tournamentController.updateTournament);
// 👉 ROTA PARA CONCLUIR/REABRIR O TORNEIO
router.put('/status/:id', tournamentController.toggleStatus);
module.exports = router;