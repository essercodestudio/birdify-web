const express = require('express');
const router = express.Router();
const courseController = require('../controllers/courseController');

router.get('/list', courseController.listCourses);
router.post('/create', courseController.createCourse);
router.get('/:id/holes', courseController.getCourseHoles);
router.post('/update-holes', courseController.updateHoles);
router.delete('/delete/:id', courseController.deleteCourse);
router.put('/update/:id', courseController.updateCourse);

module.exports = router;