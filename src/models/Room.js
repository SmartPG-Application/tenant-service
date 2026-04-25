const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
  roomNumber: { type: String, required: true, unique: true },
  floor: { type: String, required: true },
  type: { type: String, enum: ['single', 'double', 'triple'], required: true },
  rent: { type: Number, required: true },
  amenities: [{ type: String }],
  status: { type: String, enum: ['Available', 'Occupied', 'Maintenance'], default: 'Available' },
  occupants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' }]
}, { timestamps: true });

module.exports = mongoose.model('Room', roomSchema);
