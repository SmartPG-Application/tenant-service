const express = require('express');
const router = express.Router();
const {
  getRooms,
  getAvailableRooms,
  allocateRoom,
  createRoom,
  updateRoom,
  releaseRoom,
  getRoomById
} = require('../controllers/roomController');
const { verifyToken, isAdmin } = require('../middleware/auth');

router.route('/')
  .get(verifyToken, isAdmin, getRooms)
  .post(verifyToken, isAdmin, createRoom);

router.get('/available', verifyToken, isAdmin, getAvailableRooms);
router.post('/allocate', verifyToken, isAdmin, allocateRoom);

router.get('/:id', verifyToken, getRoomById);
router.put('/:id', verifyToken, isAdmin, updateRoom);
router.put('/:id/release', verifyToken, isAdmin, releaseRoom);

module.exports = router;
