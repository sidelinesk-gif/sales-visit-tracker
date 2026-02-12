const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/db');
const { isAuthenticated, requireRole } = require('../middleware/auth');
const generateVisitsCsv = require('../utils/csv-export');

const router = express.Router();

async function getAllVisits({ from, to }) {
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
  let paramIndex = 1;

  if (from) {
    sql += ` AND DATE(v.created_at) >= $${paramIndex}`;
    params.push(from);
    paramIndex++;
  }
  if (to) {
    sql += ` AND DATE(v.created_at) <= $${paramIndex}`;
    params.push(to);
    paramIndex++;
  }

  sql += ' ORDER BY v.created_at DESC';
  const result = await pool.query(sql, params);
  console.log(`[CSV Export] Query returned ${result.rows.length} visit(s)`);
  return result.rows;
}

// GET /admin — dashboard
router.get('/admin', isAuthenticated, requireRole('admin'), async (req, res) => {
  const usersResult = await pool.query(`
    SELECT u.*, m.name AS manager_name
    FROM users u
    LEFT JOIN users m ON m.id = u.manager_id
    ORDER BY u.role, u.name
  `);

  const clientsResult = await pool.query(`
    SELECT c.*,
      STRING_AGG(rep.name, ', ') AS assigned_reps
    FROM clients c
    LEFT JOIN client_assignments ca ON ca.client_id = c.id
    LEFT JOIN users rep ON rep.id = ca.sales_rep_id
    GROUP BY c.id
    ORDER BY c.approved ASC, c.name
  `);

  const managersResult = await pool.query("SELECT id, name FROM users WHERE role IN ('admin','manager') AND is_active = 1 ORDER BY name");
  const repsResult = await pool.query("SELECT id, name FROM users WHERE role = 'sales_rep' AND is_active = 1 ORDER BY name");

  const userCount = await pool.query('SELECT COUNT(*) AS c FROM users');
  const clientCount = await pool.query('SELECT COUNT(*) AS c FROM clients');
  const visitCount = await pool.query('SELECT COUNT(*) AS c FROM visits');
  const pendingCount = await pool.query('SELECT COUNT(*) AS c FROM clients WHERE approved = 0');

  const stats = {
    users: parseInt(userCount.rows[0].c),
    clients: parseInt(clientCount.rows[0].c),
    visits: parseInt(visitCount.rows[0].c),
    pendingClients: parseInt(pendingCount.rows[0].c)
  };

  res.render('admin', {
    title: 'Admin Panel',
    users: usersResult.rows,
    clients: clientsResult.rows,
    managers: managersResult.rows,
    reps: repsResult.rows,
    stats,
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || ''
  });
});

// POST /admin/users — create user
router.post('/admin/users', isAuthenticated, requireRole('admin'), async (req, res) => {
  const { name, email, password, role, manager_id } = req.body;
  if (!name || !email || !password || !role) {
    return res.status(400).render('error', { title: 'Error', message: 'All fields are required.' });
  }
  if (!['admin', 'manager', 'sales_rep'].includes(role)) {
    return res.status(400).render('error', { title: 'Error', message: 'Invalid role.' });
  }
  const hash = bcrypt.hashSync(password, 10);
  try {
    await pool.query(
      'INSERT INTO users (name, email, password_hash, role, manager_id) VALUES ($1, $2, $3, $4, $5)',
      [name.trim(), email.trim().toLowerCase(), hash, role, manager_id || null]
    );
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).render('error', { title: 'Error', message: 'A user with this email already exists.' });
    }
    throw err;
  }
  res.redirect('/admin');
});

// POST /admin/users/:id/toggle — activate/deactivate
router.post('/admin/users/:id/toggle', isAuthenticated, requireRole('admin'), async (req, res) => {
  const result = await pool.query('SELECT is_active FROM users WHERE id = $1', [req.params.id]);
  const user = result.rows[0];
  if (user) {
    await pool.query('UPDATE users SET is_active = $1 WHERE id = $2', [user.is_active ? 0 : 1, req.params.id]);
  }
  res.redirect('/admin');
});

// POST /admin/users/:id/reset-device — clear device fingerprint
router.post('/admin/users/:id/reset-device', isAuthenticated, requireRole('admin'), async (req, res) => {
  await pool.query('UPDATE users SET device_fingerprint = NULL WHERE id = $1', [req.params.id]);
  res.redirect('/admin');
});

// POST /admin/clients — create client
router.post('/admin/clients', isAuthenticated, requireRole('admin'), async (req, res) => {
  const { name, latitude, longitude, geo_radius, location_name } = req.body;
  if (!name || !latitude || !longitude) {
    return res.status(400).render('error', { title: 'Error', message: 'Name, latitude and longitude are required.' });
  }
  await pool.query(
    'INSERT INTO clients (name, latitude, longitude, geo_radius, location_name, status, approved, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [name.trim(), parseFloat(latitude), parseFloat(longitude), parseInt(geo_radius) || 50, location_name ? location_name.trim() : null, 'Existing', 1, req.session.user.id]
  );
  res.redirect('/admin');
});

// POST /admin/clients/:id/approve — approve a pending client
router.post('/admin/clients/:id/approve', isAuthenticated, requireRole('admin'), async (req, res) => {
  await pool.query('UPDATE clients SET approved = 1 WHERE id = $1', [req.params.id]);
  res.redirect('/admin');
});

// POST /admin/assign — assign client to sales rep
router.post('/admin/assign', isAuthenticated, requireRole('admin'), async (req, res) => {
  const { sales_rep_id, client_id } = req.body;
  if (!sales_rep_id || !client_id) {
    return res.status(400).render('error', { title: 'Error', message: 'Sales rep and client are required.' });
  }
  try {
    await pool.query(
      'INSERT INTO client_assignments (sales_rep_id, client_id) VALUES ($1, $2)',
      [sales_rep_id, client_id]
    );
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).render('error', { title: 'Error', message: 'This client is already assigned to this rep.' });
    }
    throw err;
  }
  res.redirect('/admin');
});

// GET /admin/export — export all visits as CSV
router.get('/admin/export', isAuthenticated, requireRole('admin'), async (req, res) => {
  const { from, to } = req.query;
  console.log('[Admin Export] Query params:', { from, to });

  const visits = await getAllVisits({ from, to });
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
