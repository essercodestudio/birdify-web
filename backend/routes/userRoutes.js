const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');

router.get('/players', userController.getAllPlayers);

module.exports = router;