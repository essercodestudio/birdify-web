const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const router = express.Router();
const courseController = require('../controllers/courseController');
const courseTeeRulesController = require('../controllers/courseTeeRulesController');
const courseTeesController = require('../controllers/courseTeesController');
const { requireAuth, requireAdmin } = require('../middlewares/authMiddleware');

// Upload de imagem por buraco — arquivo vai pra public/uploads/holes/{clubId}/
// e o nome é determinístico ({courseId}-{holeNumber}.ext) pra substituir versões antigas.
const holeImagesUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, '..', 'public', 'uploads', 'holes', String(req.club.id));
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const raw = (path.extname(file.originalname) || '.jpg').toLowerCase();
      const ext = ['.jpg', '.jpeg', '.png', '.webp'].includes(raw) ? raw : '.jpg';
      cb(null, `${req.params.courseId}-${req.params.holeNumber}${ext}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Apenas .jpg, .png ou .webp são permitidos.'));
  },
});

// Visualização pública do campo (espectadores). Multi-tenant filtra por req.club.id.
router.get('/:courseId/preview', courseController.getCoursePreview);

// Listagem — precisa apenas de auth (usada por telas de jogador ao criar treino/inscrever)
router.get('/', requireAuth, courseController.listCourses);
router.get('/list', requireAuth, courseController.listCourses);
router.get('/:id/holes', requireAuth, courseController.getCourseHoles);

// Mutações — apenas ADMIN do clube
router.post('/create', requireAdmin, courseController.createCourse);
router.post('/update-holes', requireAdmin, courseController.updateHoles);
router.delete('/delete/:id', requireAdmin, courseController.deleteCourse);
router.put('/update/:id', requireAdmin, courseController.updateCourse);

// Regras de "faixa de handicap → tee" por campo.
// GET aberto pra qualquer jogador logado (usado no lobby pra sugerir tee);
// PUT é bulk replace só do admin.
router.get('/:id/tee-rules', requireAuth, courseTeeRulesController.getTeeRules);
router.put('/:id/tee-rules', requireAdmin, courseTeeRulesController.replaceTeeRules);

// Tees dinâmicos por campo (nome/cor livres). Granular pra preservar IDs
// e evitar cascade destrutivo das regras que apontam pros tees.
router.get   ('/:id/tees',          requireAuth,  courseTeesController.listTees);
router.post  ('/:id/tees',          requireAdmin, courseTeesController.createTee);
router.put   ('/:id/tees/:teeId',   requireAdmin, courseTeesController.updateTee);
router.delete('/:id/tees/:teeId',   requireAdmin, courseTeesController.deleteTee);

// Imagem por buraco (Feature 2)
router.post(
  '/:courseId/holes/:holeNumber/image',
  requireAdmin,
  holeImagesUpload.single('image'),
  courseController.uploadHoleImage,
);
router.delete(
  '/:courseId/holes/:holeNumber/image',
  requireAdmin,
  courseController.deleteHoleImage,
);

module.exports = router;
