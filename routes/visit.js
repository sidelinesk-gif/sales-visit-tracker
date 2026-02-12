const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const pool = require('../db/db');
const { isAuthenticated, requireRole } = require('../middleware/auth');
const haversineDistance = require('../utils/haversine');

const router = express.Router();

const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'uploads'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `selfie-${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// GET /visit — render visit form
router.get('/visit', isAuthenticated, requireRole('sales_rep'), async (req, res) => {
  const result = await pool.query(`
    SELECT c.id, c.name, c.latitude, c.longitude, c.geo_radius
    FROM clients c
    JOIN client_assignments ca ON ca.client_id = c.id
    WHERE ca.sales_rep_id = $1 AND c.approved = 1
    ORDER BY c.name
  `, [req.session.user.id]);

  res.render('visit', { title: 'Log Visit', clients: result.rows });
});

// POST /api/visit — handle visit submission
router.post('/api/visit', isAuthenticated, requireRole('sales_rep'), upload.single('selfie'), async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { client_id, new_client_name, client_lat, client_lng, client_location_name, latitude, longitude, accuracy, visit_purpose, notes, visit_location_name } = req.body;

    let finalClientId = client_id;

    // Handle new client creation
    if (!client_id && new_client_name && client_lat && client_lng) {
      const insertResult = await pool.query(
        'INSERT INTO clients (name, latitude, longitude, location_name, status, approved, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        [new_client_name.trim(), parseFloat(client_lat), parseFloat(client_lng), client_location_name || null, 'New', 0, userId]
      );
      finalClientId = insertResult.rows[0].id;

      await pool.query(
        'INSERT INTO client_assignments (sales_rep_id, client_id) VALUES ($1, $2)',
        [userId, finalClientId]
      );
    }

    if (!finalClientId || !latitude || !longitude) {
      return res.status(400).json({ error: 'Client and location are required.' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Selfie photo is required.' });
    }

    // Calculate distance from client
    const clientResult = await pool.query('SELECT latitude, longitude, geo_radius FROM clients WHERE id = $1', [finalClientId]);
    const client = clientResult.rows[0];
    if (!client) {
      return res.status(400).json({ error: 'Client not found.' });
    }

    const distance = haversineDistance(
      parseFloat(latitude), parseFloat(longitude),
      client.latitude, client.longitude
    );
    const withinGeofence = distance <= (client.geo_radius || 50) ? 1 : 0;

    // Determine system flag
    let systemFlag = 'OK';
    if (accuracy && parseFloat(accuracy) > 100) {
      systemFlag = 'LOW_ACCURACY';
    } else if (!withinGeofence) {
      systemFlag = 'OUTSIDE_GEOFENCE';
    }

    const selfiePath = '/uploads/' + req.file.filename;

    await pool.query(`
      INSERT INTO visits (sales_rep_id, client_id, latitude, longitude, accuracy, distance_from_client, within_geofence, visit_purpose, notes, selfie_path, device_fingerprint, system_flag, visit_location_name)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `, [
      userId, finalClientId,
      parseFloat(latitude), parseFloat(longitude),
      accuracy ? parseFloat(accuracy) : null,
      Math.round(distance * 100) / 100,
      withinGeofence,
      visit_purpose || null,
      notes || null,
      selfiePath,
      null,
      systemFlag,
      visit_location_name || null
    ]);

    res.json({ success: true, distance: Math.round(distance), withinGeofence: !!withinGeofence });
  } catch (err) {
    console.error('Visit submission error:', err);
    res.status(500).json({ error: 'Failed to record visit. Please try again.' });
  }
});

module.exports = router;
