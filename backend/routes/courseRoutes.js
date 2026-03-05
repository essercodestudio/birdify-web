
const express = require('express');
const router = express.Router();
const courseController = require('../controllers/courseController');

router.get('/list', courseController.listCourses);
router.get('/:courseId/holes', courseController.getCourseHoles);


router.post('/create', courseController.createCourse);      
router.post('/update-holes', courseController.updateHoles); 

router.delete('/delete/:id', courseController.deleteCourse);

module.exports = router;
