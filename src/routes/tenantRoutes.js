const express = require('express');
const router = express.Router();
const {
  registerTenant,
  loginTenant,
  selfRegister,
  adminCreateTenant,
  getTenants,
  getTenantById,
  updateTenant,
  deleteTenant,
  updateTenantStatus,
  updateTenantPassword,
  getTenantSummary,
  getPendingTenants,
  approveTenant,
  rejectTenant,
} = require('../controllers/tenantController');
const { verifyToken, isAdmin, isSelf } = require('../middleware/auth');

// ── PUBLIC: Auth routes (no token required) ─────────────
router.post('/auth/login', loginTenant);
router.post('/auth/register', selfRegister);

// ── ADMIN: Create tenant directly (immediately active) ──
router.post('/auth/admin-create', verifyToken, isAdmin, adminCreateTenant);

// ── ADMIN: Tenant management ────────────────────────────
router.get('/tenants', verifyToken, isAdmin, getTenants);
router.get('/tenants/pending', verifyToken, isAdmin, getPendingTenants);
router.put('/tenants/:id/approve', verifyToken, isAdmin, approveTenant);
router.put('/tenants/:id/reject', verifyToken, isAdmin, rejectTenant);
router.put('/tenants/:id/status', verifyToken, isAdmin, updateTenantStatus);
router.delete('/tenants/:id', verifyToken, isAdmin, deleteTenant);
router.get('/tenants/:id/summary', verifyToken, isAdmin, getTenantSummary);

// ── SELF or ADMIN: Tenant profile ───────────────────────
router.get('/tenants/:id', verifyToken, isSelf, getTenantById);
router.put('/tenants/:id', verifyToken, isSelf, updateTenant);
router.put('/tenants/:id/password', verifyToken, isSelf, updateTenantPassword);

module.exports = router;
