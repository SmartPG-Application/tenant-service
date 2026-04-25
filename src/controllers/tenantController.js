const Tenant = require('../models/Tenant');
const Room = require('../models/Room');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');

const generateToken = (tenant) => {
  return jwt.sign(
    {
      id: tenant._id,
      email: tenant.email,
      role: tenant.role,
      name: tenant.name,
      tempPassword: tenant.tempPassword,
    },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );
};

// Helper: fire-and-forget notification
const sendNotification = async (data) => {
  try {
    const notifUrl = process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:4005';
    await axios.post(
      `${notifUrl}/api/notifications`,
      data,
      {
        headers: { 'x-internal-service': 'true' },
        timeout: 3000,
      }
    );
  } catch (err) {
    console.error('Notification send failed:', err.message);
  }
};

// ── LOGIN ─────────────────────────────────────────────────
// @desc Auth tenant & get token
// @route POST /api/auth/login
exports.loginTenant = async (req, res) => {
  try {
    const { email, password } = req.body;
    const tenant = await Tenant.findOne({ email });

    if (!tenant) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const isMatch = await tenant.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // STATUS CHECKS (treat null/undefined as 'active' for backward compat)
    const tenantStatus = tenant.status || 'active';

    if (tenantStatus === 'pending') {
      return res.status(403).json({
        message: 'Your account is pending admin approval. Please wait for approval before logging in.',
        status: 'pending',
        code: 'ACCOUNT_PENDING',
      });
    }

    if (tenantStatus === 'rejected') {
      return res.status(403).json({
        message: 'Your registration has been rejected. Please contact the admin for more information.',
        status: 'rejected',
        code: 'ACCOUNT_REJECTED',
        reason: tenant.rejectionReason,
      });
    }

    if (tenantStatus === 'inactive') {
      return res.status(403).json({
        message: 'Your account has been deactivated. Please contact admin.',
        status: 'inactive',
        code: 'ACCOUNT_INACTIVE',
      });
    }

    // Generate JWT - only active tenants reach here
    const token = generateToken(tenant);

    res.json({
      _id: tenant._id,
      name: tenant.name,
      email: tenant.email,
      role: tenant.role,
      status: tenant.status,
      tempPassword: tenant.tempPassword,
      roomNumber: tenant.roomNumber,
      token,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error during login' });
  }
};

// ── SELF REGISTER ─────────────────────────────────────────
// PUBLIC route - no auth required
// @desc Self-register new tenant (pending approval)
// @route POST /api/auth/register
exports.selfRegister = async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      password,
      emergencyContact,
      idProofType,
    } = req.body;

    if (!name || !email || !phone || !password) {
      return res.status(400).json({ message: 'Name, email, phone and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    // Check if email already taken
    const existingTenant = await Tenant.findOne({ email });
    if (existingTenant) {
      // Check if previously rejected - allow re-register
      if (existingTenant.status === 'rejected') {
        await Tenant.findByIdAndDelete(existingTenant._id);
      } else {
        return res.status(409).json({
          message: 'An account with this email already exists.',
          code: 'EMAIL_EXISTS',
        });
      }
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create tenant with pending status
    const tenant = await Tenant.create({
      name,
      email,
      phone,
      password: hashedPassword,
      emergencyContact: emergencyContact || '',
      idProofType: idProofType || 'Aadhar',
      role: 'tenant',
      status: 'pending',
      registrationType: 'self-registered',
      tempPassword: false,
    });

    return res.status(201).json({
      message: 'Registration successful. Your account is pending admin approval.',
      tenant: {
        id: tenant._id,
        name: tenant.name,
        email: tenant.email,
        status: tenant.status,
        registrationType: tenant.registrationType,
      },
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error during registration' });
  }
};

// ── ADMIN CREATE TENANT ───────────────────────────────────
// Admin creates tenant - immediately active
// @desc Register new tenant (by admin)
// @route POST /api/auth/admin-create
exports.adminCreateTenant = async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      password,
      emergencyContact,
      idProofType,
      roomId,
    } = req.body;

    if (!name || !email || !phone) {
      return res.status(400).json({ message: 'Name, email and phone are required' });
    }

    const existingTenant = await Tenant.findOne({ email });
    if (existingTenant) {
      return res.status(409).json({
        message: 'A tenant with this email already exists.',
      });
    }

    // Auto-generate password if not provided
    let rawPassword = password;
    let isAutoGenerated = false;

    if (!rawPassword || rawPassword.trim() === '') {
      const randomDigits = Math.floor(1000 + Math.random() * 9000);
      rawPassword = `SmartPG@${randomDigits}`;
      isAutoGenerated = true;
    }

    const hashedPassword = await bcrypt.hash(rawPassword, 12);

    // Create tenant - immediately active
    const tenant = await Tenant.create({
      name,
      email,
      phone,
      password: hashedPassword,
      emergencyContact: emergencyContact || '',
      idProofType: idProofType || 'Aadhar',
      role: 'tenant',
      status: 'active',
      registrationType: 'admin-created',
      tempPassword: isAutoGenerated,
    });

    // Assign room if provided
    if (roomId) {
      const room = await Room.findById(roomId);
      if (room && room.status === 'Available') {
        const capacity = room.type === 'single' ? 1 : room.type === 'double' ? 2 : 3;
        if (room.occupants.length < capacity) {
          room.occupants.push(tenant._id);
          if (room.occupants.length >= capacity) {
            room.status = 'Occupied';
          }
          await room.save();
          tenant.roomId = room._id;
          tenant.roomNumber = room.roomNumber;
          await tenant.save();
        }
      }
    }

    // Notify (fire and forget)
    sendNotification({
      tenantId: tenant._id,
      type: 'announcement',
      title: 'Welcome to SmartPG!',
      message: `Hello ${name}! Your account has been created by admin. ${isAutoGenerated ? 'Please change your temporary password after login.' : 'You can now login with your credentials.'}`,
    });

    return res.status(201).json({
      message: 'Tenant created successfully',
      tenant: tenant.toJSON(),
      generatedPassword: isAutoGenerated ? rawPassword : null,
      isAutoGenerated,
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error creating tenant' });
  }
};

// ── LEGACY: Register (kept for backward compatibility, now calls selfRegister logic)
// @desc Register new tenant
// @route POST /api/auth/register (old endpoint still works)
exports.registerTenant = exports.selfRegister;

// ── GET ALL TENANTS (admin) ───────────────────────────────
// @desc Get all tenants
// @route GET /api/tenants
exports.getTenants = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      search = '',
      status = '',
    } = req.query;

    const filter = { role: 'tenant' };

    // By default exclude pending from main list
    if (status) {
      filter.status = status;
    } else {
      filter.status = { $in: ['active', 'inactive', null], $nin: ['pending', 'rejected'] };
    }

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ];
    }

    const tenants = await Tenant.find(filter)
      .select('-password')
      .populate('roomId')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const total = await Tenant.countDocuments(filter);

    res.json(tenants);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ── GET PENDING TENANTS (admin) ───────────────────────────
// @desc Get all pending tenants
// @route GET /api/tenants/pending
exports.getPendingTenants = async (req, res) => {
  try {
    const pendingTenants = await Tenant.find({
      status: 'pending',
    })
      .select('-password')
      .sort({ createdAt: -1 });

    return res.json({
      tenants: pendingTenants,
      count: pendingTenants.length,
    });
  } catch (err) {
    res.status(500).json({ message: 'Error fetching pending tenants' });
  }
};

// ── APPROVE TENANT (admin) ────────────────────────────────
// @desc Approve a pending tenant
// @route PUT /api/tenants/:id/approve
exports.approveTenant = async (req, res) => {
  try {
    const { roomId } = req.body;
    const tenant = await Tenant.findById(req.params.id);

    if (!tenant) {
      return res.status(404).json({ message: 'Tenant not found' });
    }

    if (tenant.status !== 'pending') {
      return res.status(400).json({
        message: 'Tenant is not in pending status',
      });
    }

    // Approve tenant
    tenant.status = 'active';
    await tenant.save();

    // Assign room if provided
    if (roomId) {
      const room = await Room.findById(roomId);
      if (room && room.status === 'Available') {
        const capacity = room.type === 'single' ? 1 : room.type === 'double' ? 2 : 3;
        if (room.occupants.length < capacity) {
          room.occupants.push(tenant._id);
          if (room.occupants.length >= capacity) {
            room.status = 'Occupied';
          }
          await room.save();
          tenant.roomId = room._id;
          tenant.roomNumber = room.roomNumber;
          await tenant.save();
        }
      }
    }

    // Notify tenant
    sendNotification({
      tenantId: tenant._id,
      type: 'announcement',
      title: '🎉 Account Approved!',
      message: `Welcome to SmartPG, ${tenant.name}! Your account has been approved. ${roomId ? `You have been assigned Room ${tenant.roomNumber}.` : 'Please contact admin to get a room assigned.'} You can now login with your registered credentials.`,
    });

    return res.json({
      message: 'Tenant approved successfully',
      tenant: tenant.toJSON(),
    });
  } catch (err) {
    res.status(500).json({ message: 'Error approving tenant' });
  }
};

// ── REJECT TENANT (admin) ─────────────────────────────────
// @desc Reject a pending tenant
// @route PUT /api/tenants/:id/reject
exports.rejectTenant = async (req, res) => {
  try {
    const { reason = 'Application rejected by admin' } = req.body;
    const tenant = await Tenant.findById(req.params.id);

    if (!tenant) {
      return res.status(404).json({ message: 'Tenant not found' });
    }

    if (tenant.status !== 'pending') {
      return res.status(400).json({
        message: 'Tenant is not in pending status',
      });
    }

    tenant.status = 'rejected';
    tenant.rejectionReason = reason;
    await tenant.save();

    return res.json({
      message: 'Tenant registration rejected',
    });
  } catch (err) {
    res.status(500).json({ message: 'Error rejecting tenant' });
  }
};

// ── GET TENANT BY ID ──────────────────────────────────────
// @desc Get tenant by ID
// @route GET /api/tenants/:id
exports.getTenantById = async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.params.id).select('-password').populate('roomId');
    if (tenant) {
      res.json(tenant);
    } else {
      res.status(404).json({ message: 'Tenant not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ── UPDATE TENANT ─────────────────────────────────────────
// @desc Update tenant
// @route PUT /api/tenants/:id
exports.updateTenant = async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.params.id);
    if (tenant) {
      tenant.name = req.body.name || tenant.name;
      tenant.phone = req.body.phone || tenant.phone;
      if (req.body.emergencyContact !== undefined) {
        tenant.emergencyContact = req.body.emergencyContact;
      }
      if (req.body.password) {
        tenant.password = await bcrypt.hash(req.body.password, 12);
      }
      const updatedTenant = await tenant.save();
      res.json({
        _id: updatedTenant._id,
        name: updatedTenant.name,
        email: updatedTenant.email,
        phone: updatedTenant.phone,
      });
    } else {
      res.status(404).json({ message: 'Tenant not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ── DELETE TENANT ─────────────────────────────────────────
// @desc Delete tenant
// @route DELETE /api/tenants/:id
exports.deleteTenant = async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.params.id);
    if (tenant) {
      // Release room if allocated
      if (tenant.roomId) {
        const room = await Room.findById(tenant.roomId);
        if (room) {
          room.occupants = room.occupants.filter(id => id.toString() !== tenant._id.toString());
          room.status = 'Available';
          await room.save();
        }
      }
      await tenant.deleteOne();
      res.json({ message: 'Tenant removed' });
    } else {
      res.status(404).json({ message: 'Tenant not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ── UPDATE TENANT STATUS ──────────────────────────────────
exports.updateTenantStatus = async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.params.id);
    if (!tenant) return res.status(404).json({ message: 'Tenant not found' });

    const { status } = req.body;
    if (!['active', 'inactive'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status. Use active or inactive' });
    }

    tenant.status = status;
    // Keep backward compat
    tenant.isActive = status === 'active';
    await tenant.save();
    res.json({ message: `Tenant status updated to ${status}` });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ── UPDATE PASSWORD ───────────────────────────────────────
exports.updateTenantPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const tenant = await Tenant.findById(req.params.id);

    if (!tenant) return res.status(404).json({ message: 'Tenant not found' });
    if (!(await tenant.matchPassword(currentPassword))) {
      return res.status(400).json({ message: 'Invalid current password' });
    }

    tenant.password = await bcrypt.hash(newPassword, 12);
    tenant.tempPassword = false;
    await tenant.save();
    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ── GET TENANT SUMMARY ────────────────────────────────────
exports.getTenantSummary = async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.params.id).select('-password').populate('roomId');
    if (!tenant) return res.status(404).json({ message: 'Tenant not found' });

    const authHeader = { headers: { Authorization: req.headers.authorization } };

    let paymentCount = 0;
    let complaintCount = 0;

    try {
      const pRes = await axios.get(`http://payment-service:4002/api/payments/tenant/${req.params.id}`, authHeader);
      paymentCount = pRes.data.length;
    } catch (e) {}

    try {
      const cRes = await axios.get(`http://complaint-service:4004/api/complaints/tenant/${req.params.id}`, authHeader);
      complaintCount = cRes.data.length;
    } catch (e) {}

    res.json({
      profile: tenant,
      paymentCount,
      complaintCount,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
