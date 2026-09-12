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
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const router = express.Router();
const tournamentController = require('../controllers/tournamentController');
const { requireAuth, requireAdmin } = require('../middlewares/authMiddleware');

// Onda C · Fase C.5: upload de capa do torneio.
// Mesmo padrao do holeImagesUpload (courseRoutes.js): diskStorage isolado
// por clube, filename deterministico (${tournamentId}.{ext}) pra que o
// arquivo novo sobrescreva a versao antiga de mesma extensao. Cache-bust
// no frontend com ?t=Date.now() (padrao ja usado no CourseManager).
const tournamentCoverUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            const dir = path.join(__dirname, '..', 'public', 'uploads', 'tournaments', String(req.club.id));
            fs.mkdirSync(dir, { recursive: true });
            cb(null, dir);
        },
        filename: (req, file, cb) => {
            const raw = (path.extname(file.originalname) || '.jpg').toLowerCase();
            const ext = ['.jpg', '.jpeg', '.png', '.webp'].includes(raw) ? raw : '.jpg';
            cb(null, `${req.params.id}${ext}`);
        },
    }),
    limits: { fileSize: 3 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (/^image\/(jpeg|png|webp)$/.test(file.mimetype)) cb(null, true);
        else cb(new Error('Apenas .jpg, .png ou .webp sao permitidos.'));
    },
});

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

// Upload de capa do torneio (Onda C · Fase C.5). Rota separada do
// create/update pra centralizar a validacao do arquivo no handler (evita
// path forjado no body). requireAdmin + multer inline.
router.post(
    '/:id/cover',
    requireAdmin,
    tournamentCoverUpload.single('cover'),
    tournamentController.uploadTournamentCover,
);

module.exports = router;
