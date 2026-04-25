const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const Tenant = require('../models/Tenant');
const Room = require('../models/Room');

const seedData = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://admin:password@localhost:27017/smartpg_db?authSource=admin');
    console.log('Connected to MongoDB for seeding');

    // ── MIGRATION: Set status='active' on all existing tenants that lack a status field ──
    const migrated = await Tenant.updateMany(
      { status: { $exists: false } },
      { $set: { status: 'active', registrationType: 'admin-created' } }
    );
    if (migrated.modifiedCount > 0) {
      console.log(`Migrated ${migrated.modifiedCount} existing tenants to status=active`);
    }

    // ── MIGRATION: Fix any tenants with plain-text passwords (not bcrypt hash) ──
    const allTenants = await Tenant.find({});
    for (const t of allTenants) {
      // bcrypt hashes always start with $2a$ or $2b$
      if (t.password && !t.password.startsWith('$2')) {
        const hashed = await bcrypt.hash(t.password, 12);
        await Tenant.updateOne({ _id: t._id }, { $set: { password: hashed } });
        console.log(`Re-hashed password for ${t.email}`);
      }
    }

    // ── Admin Account ──
    const adminExists = await Tenant.findOne({ email: 'admin@smartpg.com' });
    if (!adminExists) {
      const hashedPassword = await bcrypt.hash('Admin@123', 12);
      await Tenant.create({
        name: 'Admin User',
        email: 'admin@smartpg.com',
        password: hashedPassword,
        phone: '1234567890',
        role: 'admin',
        status: 'active',
        registrationType: 'admin-created',
      });
      console.log('Created Admin User: admin@smartpg.com / Admin@123');
    } else {
      // Update existing admin password to match demo credentials
      const hashedPassword = await bcrypt.hash('Admin@123', 12);
      await Tenant.updateOne(
        { email: 'admin@smartpg.com' },
        { $set: { password: hashedPassword, status: 'active', role: 'admin' } }
      );
      console.log('Updated Admin User password: admin@smartpg.com / Admin@123');
    }

    // ── Rooms (101-103 Single, 201-203 Double, 301-304 Triple) ──
    const rooms = [
      { roomNumber: '101', floor: '1', type: 'single', rent: 8000, amenities: ['WiFi', 'AC'] },
      { roomNumber: '102', floor: '1', type: 'single', rent: 8000, amenities: ['WiFi', 'AC'] },
      { roomNumber: '103', floor: '1', type: 'single', rent: 8500, amenities: ['WiFi', 'AC', 'Balcony'] },
      { roomNumber: '201', floor: '2', type: 'double', rent: 6000, amenities: ['WiFi', 'Geyser'] },
      { roomNumber: '202', floor: '2', type: 'double', rent: 6000, amenities: ['WiFi', 'Geyser'] },
      { roomNumber: '203', floor: '2', type: 'double', rent: 6500, amenities: ['WiFi', 'Balcony'] },
      { roomNumber: '301', floor: '3', type: 'triple', rent: 5000, amenities: ['WiFi'] },
      { roomNumber: '302', floor: '3', type: 'triple', rent: 5000, amenities: ['WiFi'] },
      { roomNumber: '303', floor: '3', type: 'triple', rent: 5500, amenities: ['WiFi'] },
      { roomNumber: '304', floor: '3', type: 'triple', rent: 5000, amenities: ['WiFi'] },
    ];

    for (const r of rooms) {
      let room = await Room.findOne({ roomNumber: r.roomNumber });
      if (!room) {
        room = await Room.create(r);
        console.log(`Created Room ${r.roomNumber}`);
      }
    }

    // ── Demo Tenants ──
    const tenantData = [
      { name: 'Rahul Sharma', email: 'rahul@smartpg.com', password: 'Tenant@123', phone: '9876543210', roomNumber: '101' },
      { name: 'Priya Patel', email: 'priya@smartpg.com', password: 'Tenant@123', phone: '9876543211', roomNumber: '102' },
      { name: 'Amit Kumar', email: 'amit@smartpg.com', password: 'Tenant@123', phone: '9876543212', roomNumber: '103' },
    ];

    for (const t of tenantData) {
      let tenant = await Tenant.findOne({ email: t.email });
      if (!tenant) {
        const room = await Room.findOne({ roomNumber: t.roomNumber });
        const hashedPassword = await bcrypt.hash(t.password, 12);
        tenant = await Tenant.create({
          name: t.name,
          email: t.email,
          password: hashedPassword,
          phone: t.phone,
          role: 'tenant',
          status: 'active',
          registrationType: 'admin-created',
          roomId: room ? room._id : null,
          roomNumber: t.roomNumber,
        });

        if (room) {
          room.occupants = room.occupants || [];
          room.occupants.push(tenant._id);
          const capacity = room.type === 'single' ? 1 : room.type === 'double' ? 2 : 3;
          if (room.occupants.length >= capacity) {
            room.status = 'Occupied';
          }
          await room.save();
        }
        console.log(`Created Tenant ${t.email}`);
      } else {
        // Update existing tenant password to match demo credentials
        const hashedPassword = await bcrypt.hash(t.password, 12);
        await Tenant.updateOne(
          { email: t.email },
          { $set: { password: hashedPassword, status: 'active' } }
        );
        console.log(`Updated Tenant ${t.email} password`);
      }
    }

    console.log('Seeding completed successfully.');
    process.exit(0);
  } catch (error) {
    console.error('Seeding failed:', error);
    process.exit(1);
  }
};

seedData();
