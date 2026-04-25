const Room = require('../models/Room');
const Tenant = require('../models/Tenant');

exports.getRooms = async (req, res) => {
  try {
    const rooms = await Room.find({}).populate('occupants', 'name email');
    res.json(rooms);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getAvailableRooms = async (req, res) => {
  try {
    const rooms = await Room.find({ status: 'Available' });
    res.json(rooms);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getRoomById = async (req, res) => {
  try {
    const room = await Room.findById(req.params.id).populate('occupants', 'name email');
    if (!room) return res.status(404).json({ message: 'Room not found' });
    
    // Check if user is admin or occupies this room
    if (req.user.role !== 'admin' && !room.occupants.some(occ => occ._id.toString() === req.user.id)) {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    res.json(room);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.createRoom = async (req, res) => {
  try {
    const room = await Room.create(req.body);
    res.status(201).json(room);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateRoom = async (req, res) => {
  try {
    const room = await Room.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!room) return res.status(404).json({ message: 'Room not found' });
    res.json(room);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.allocateRoom = async (req, res) => {
  try {
    const { tenantId, roomId } = req.body;
    
    const room = await Room.findById(roomId);
    if (!room) return res.status(404).json({ message: 'Room not found' });
    
    const capacity = room.type === 'single' ? 1 : room.type === 'double' ? 2 : 3;
    if (room.occupants.length >= capacity && !room.occupants.includes(tenantId)) {
      return res.status(400).json({ message: 'Room is at full capacity' });
    }

    const tenant = await Tenant.findById(tenantId);
    if (!tenant) return res.status(404).json({ message: 'Tenant not found' });

    // Remove tenant from old room if any
    if (tenant.roomId && tenant.roomId.toString() !== roomId) {
      const oldRoom = await Room.findById(tenant.roomId);
      if (oldRoom) {
        oldRoom.occupants = oldRoom.occupants.filter(id => id.toString() !== tenantId);
        oldRoom.status = 'Available';
        await oldRoom.save();
      }
    }

    // Add to new room
    if (!room.occupants.includes(tenantId)) {
      room.occupants.push(tenantId);
    }
    
    if (room.occupants.length >= capacity) {
      room.status = 'Occupied';
    }
    await room.save();

    tenant.roomId = roomId;
    tenant.roomNumber = room.roomNumber;
    await tenant.save();

    res.json({ message: 'Room allocated successfully', room });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.releaseRoom = async (req, res) => {
  try {
    const { tenantId } = req.body;
    const room = await Room.findById(req.params.id);
    if (!room) return res.status(404).json({ message: 'Room not found' });

    room.occupants = room.occupants.filter(id => id.toString() !== tenantId);
    room.status = 'Available';
    await room.save();

    const tenant = await Tenant.findById(tenantId);
    if (tenant) {
      tenant.roomId = null;
      tenant.roomNumber = null;
      await tenant.save();
    }

    res.json({ message: 'Room released successfully', room });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
