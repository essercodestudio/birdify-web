// backend/routes/circuitRoutes.js
const express = require('express');
const router  = express.Router();
const c       = require('../controllers/circuitController');
const { requireAdmin } = require('../middlewares/authMiddleware');

// ── Sponsors globais (clube) — ANTES de /:id para evitar conflito de rota ─────
router.get('/club-sponsors',          c.listSponsorsPublic);         // público
router.get('/sponsors',               requireAdmin, c.listSponsors);
router.post('/sponsors',              requireAdmin, c.createSponsor);
router.delete('/sponsors/:sponsorId', requireAdmin, c.deleteSponsor);

// ── Circuitos ─────────────────────────────────────────────────────────────────
router.get('/',             c.listCircuits);
router.get('/:id',          c.getCircuit);
router.get('/:id/ranking',  c.getCircuitRanking);
router.get('/:id/sponsors', c.getCircuitSponsors);  // público

router.post('/',            requireAdmin, c.createCircuit);
router.put('/:id',          requireAdmin, c.updateCircuit);
router.delete('/:id',       requireAdmin, c.deleteCircuit);

router.post('/:id/stages',                                   requireAdmin, c.addStage);
router.delete('/:id/stages/:stageId',                        requireAdmin, c.removeStage);
router.post('/:id/stages/:stageId/manual-positions',         requireAdmin, c.setManualPositions);
router.delete('/:id/stages/:stageId/manual-positions',       requireAdmin, c.clearManualPositions);
router.put('/:id/stages/:stageId/scorecard',                 requireAdmin, c.adminEditScorecard);

router.post('/:id/rules',  requireAdmin, c.setRules);

// ── Patrocinadores por circuito ───────────────────────────────────────────────
router.post('/:id/sponsors',              requireAdmin, c.addCircuitSponsor);
router.delete('/:id/sponsors/:sponsorId', requireAdmin, c.removeCircuitSponsor);

module.exports = router;
