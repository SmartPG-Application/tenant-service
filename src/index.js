const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const { errorHandler } = require('./middleware/errorHandler');
const tenantRoutes = require('./routes/tenantRoutes');
const roomRoutes = require('./routes/roomRoutes');

const app = express();
const PORT = process.env.PORT;
const MONGO_URI = process.env.MONGO_URI;

// Middleware
app.use(express.json());
app.use(cors());
app.use(helmet());
app.use(morgan('dev'));

// Database Connection
mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('Connected to MongoDB - Tenant Service');

    const Tenant = require('./models/Tenant');

    // Migration: set status='active' on old documents that don't have it
    await Tenant.updateMany(
      { status: { $exists: false } },
      { $set: { status: 'active', registrationType: 'admin-created' } }
    );

    // Seed or update Admin User
    const adminExists = await Tenant.findOne({ email: 'admin@smartpg.com' });
    const adminHash = await bcrypt.hash('Admin@123', 12);
    if (!adminExists) {
      await Tenant.create({
        name: 'Admin User',
        email: 'admin@smartpg.com',
        password: adminHash,
        phone: '1234567890',
        role: 'admin',
        status: 'active',
        registrationType: 'admin-created',
      });
      console.log('Admin seeded: admin@smartpg.com / Admin@123');
    } else {
      // Always reset admin password & status on startup for dev convenience
      await Tenant.updateOne(
        { email: 'admin@smartpg.com' },
        { $set: { password: adminHash, status: 'active', role: 'admin' } }
      );
      console.log('Admin password reset: admin@smartpg.com / Admin@123');
    }

    // Seed or update Demo Tenant
    const tenantExists = await Tenant.findOne({ email: 'rahul@smartpg.com' });
    const tenantHash = await bcrypt.hash('Tenant@123', 12);
    if (!tenantExists) {
      await Tenant.create({
        name: 'Rahul Sharma',
        email: 'rahul@smartpg.com',
        password: tenantHash,
        phone: '9876543210',
        role: 'tenant',
        status: 'active',
        registrationType: 'admin-created',
      });
      console.log('Tenant seeded: rahul@smartpg.com / Tenant@123');
    } else {
      await Tenant.updateOne(
        { email: 'rahul@smartpg.com' },
        { $set: { password: tenantHash, status: 'active' } }
      );
      console.log('Tenant password reset: rahul@smartpg.com / Tenant@123');
    }
  })
  .catch((err) => console.error('MongoDB connection error:', err));

// Health & Ready endpoints
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'tenant-service' });
});

app.get('/ready', (req, res) => {
  if (mongoose.connection.readyState === 1) {
    res.status(200).json({ status: 'ready', service: 'tenant-service', db: 'connected' });
  } else {
    res.status(503).json({ status: 'not ready', service: 'tenant-service', db: 'disconnected' });
  }
});

// Routes
app.use('/api', tenantRoutes);
app.use('/api/rooms', roomRoutes);

// Error Handling
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Tenant Service running on port ${PORT}`);
});
