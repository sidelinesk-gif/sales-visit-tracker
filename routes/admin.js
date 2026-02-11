const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/db');
const { isAuthenticated, requireRole } = require('../middleware/auth');
const generateVisitsCsv = require('../utils/csv-export');

const router = express.Router();

function getAllVisits({ from, to }) {
  let sql = `
    SELECT v.*,
           rep.name AS rep_name, rep.email AS rep_email,
           mgr.name AS manager_name, mgr.email AS manager_email,
           c.name AS client_name, c.status AS client_status,
           c.location_name AS client_location
    FROM visits v
    LEFT JOIN users rep ON v.sales_rep_id = rep.id
    LEFT JOIN users mgr ON rep.manager_id = mgr.id
    LEFT JOIN clients c ON v.client_id = c.id
    WHERE 1=1
  `;
  const params = [];

  if (from) {
    sql += ' AND DATE(v.created_at) >= ?';
    params.push(from);
  }
  if (to) {
    sql += ' AND DATE(v.created_at) <= ?';
    params.push(to);
  }

  sql += ' ORDER BY v.created_at DESC';
  const results = db.prepare(sql).all(...params);
  console.log(`[CSV Export] Query returned ${results.length} visit(s)`);
  return results;
}

// GET /admin — dashboard
router.get('/admin', isAuthenticated, requireRole('admin'), (req, res) => {
  const users = db.prepare(`
    SELECT u.*, m.name AS manager_name
    FROM users u
    LEFT JOIN users m ON m.id = u.manager_id
    ORDER BY u.role, u.name
  `).all();

  const clients = db.prepare(`
    SELECT c.*,
      GROUP_CONCAT(rep.name, ', ') AS assigned_reps
    FROM clients c
    LEFT JOIN client_assignments ca ON ca.client_id = c.id
    LEFT JOIN users rep ON rep.id = ca.sales_rep_id
    GROUP BY c.id
    ORDER BY c.approved ASC, c.name
  `).all();

  const managers = db.prepare("SELECT id, name FROM users WHERE role IN ('admin','manager') AND is_active = 1 ORDER BY name").all();
  const reps = db.prepare("SELECT id, name FROM users WHERE role = 'sales_rep' AND is_active = 1 ORDER BY name").all();

  const stats = {
    users: db.prepare('SELECT COUNT(*) AS c FROM users').get().c,
    clients: db.prepare('SELECT COUNT(*) AS c FROM clients').get().c,
    visits: db.prepare('SELECT COUNT(*) AS c FROM visits').get().c,
    pendingClients: db.prepare('SELECT COUNT(*) AS c FROM clients WHERE approved = 0').get().c
  };

  res.render('admin', { title: 'Admin Panel', users, clients, managers, reps, stats, googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '' });
});

// POST /admin/users — create user
router.post('/admin/users', isAuthenticated, requireRole('admin'), (req, res) => {
  const { name, email, password, role, manager_id } = req.body;
  if (!name || !email || !password || !role) {
    return res.status(400).render('error', { title: 'Error', message: 'All fields are required.' });
  }
  if (!['admin', 'manager', 'sales_rep'].includes(role)) {
    return res.status(400).render('error', { title: 'Error', message: 'Invalid role.' });
  }
  const hash = bcrypt.hashSync(password, 10);
  try {
    db.prepare(
      'INSERT INTO users (name, email, password_hash, role, manager_id) VALUES (?, ?, ?, ?, ?)'
    ).run(name.trim(), email.trim().toLowerCase(), hash, role, manager_id || null);
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(400).render('error', { title: 'Error', message: 'A user with this email already exists.' });
    }
    throw err;
  }
  res.redirect('/admin');
});

// POST /admin/users/:id/toggle — activate/deactivate
router.post('/admin/users/:id/toggle', isAuthenticated, requireRole('admin'), (req, res) => {
  const user = db.prepare('SELECT is_active FROM users WHERE id = ?').get(req.params.id);
  if (user) {
    db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(user.is_active ? 0 : 1, req.params.id);
  }
  res.redirect('/admin');
});

// POST /admin/users/:id/reset-device — clear device fingerprint
router.post('/admin/users/:id/reset-device', isAuthenticated, requireRole('admin'), (req, res) => {
  db.prepare('UPDATE users SET device_fingerprint = NULL WHERE id = ?').run(req.params.id);
  res.redirect('/admin');
});

// POST /admin/clients — create client
router.post('/admin/clients', isAuthenticated, requireRole('admin'), (req, res) => {
  const { name, latitude, longitude, geo_radius, location_name } = req.body;
  if (!name || !latitude || !longitude) {
    return res.status(400).render('error', { title: 'Error', message: 'Name, latitude and longitude are required.' });
  }
  db.prepare(
    'INSERT INTO clients (name, latitude, longitude, geo_radius, location_name, status, approved, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(name.trim(), parseFloat(latitude), parseFloat(longitude), parseInt(geo_radius) || 50, location_name ? location_name.trim() : null, 'Existing', 1, req.session.user.id);
  res.redirect('/admin');
});

// POST /admin/clients/:id/approve — approve a pending client
router.post('/admin/clients/:id/approve', isAuthenticated, requireRole('admin'), (req, res) => {
  db.prepare('UPDATE clients SET approved = 1 WHERE id = ?').run(req.params.id);
  res.redirect('/admin');
});

// POST /admin/assign — assign client to sales rep
router.post('/admin/assign', isAuthenticated, requireRole('admin'), (req, res) => {
  const { sales_rep_id, client_id } = req.body;
  if (!sales_rep_id || !client_id) {
    return res.status(400).render('error', { title: 'Error', message: 'Sales rep and client are required.' });
  }
  try {
    db.prepare(
      'INSERT INTO client_assignments (sales_rep_id, client_id) VALUES (?, ?)'
    ).run(sales_rep_id, client_id);
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(400).render('error', { title: 'Error', message: 'This client is already assigned to this rep.' });
    }
    throw err;
  }
  res.redirect('/admin');
});

// GET /admin/export — export all visits as CSV
router.get('/admin/export', isAuthenticated, requireRole('admin'), (req, res) => {
  const { from, to } = req.query;
  console.log('[Admin Export] Query params:', { from, to });

  const visits = getAllVisits({ from, to });
  console.log(`[Admin Export] Rows returned: ${visits.length}`);

  const csv = generateVisitsCsv(visits);
  console.log(`[Admin Export] CSV length: ${csv.length} bytes, ${csv.split('\n').length} lines`);

  const dateStr = new Date().toISOString().split('T')[0];

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=all_visits_${dateStr}.csv`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(csv);
});

module.exports = router;
