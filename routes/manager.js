const express = require('express');
const db = require('../db/db');
const { isAuthenticated, requireRole } = require('../middleware/auth');
const generateVisitsCsv = require('../utils/csv-export');

const router = express.Router();

function getTeamVisits(managerId, { from, to, repId }) {
  let sql = `
    SELECT v.id, v.latitude, v.longitude, v.accuracy, v.distance_from_client,
           v.within_geofence, v.visit_purpose, v.notes, v.selfie_path,
           v.device_fingerprint, v.system_flag, v.created_at,
           v.visit_location_name,
           rep.name AS rep_name, rep.email AS rep_email,
           mgr.name AS manager_name, mgr.email AS manager_email,
           c.name AS client_name, c.status AS client_status,
           c.location_name AS client_location
    FROM visits v
    LEFT JOIN users rep ON rep.id = v.sales_rep_id
    LEFT JOIN users mgr ON mgr.id = rep.manager_id
    LEFT JOIN clients c ON c.id = v.client_id
    WHERE rep.manager_id = ?
  `;
  const params = [managerId];

  if (from) {
    sql += ' AND DATE(v.created_at) >= ?';
    params.push(from);
  }
  if (to) {
    sql += ' AND DATE(v.created_at) <= ?';
    params.push(to);
  }
  if (repId) {
    sql += ' AND v.sales_rep_id = ?';
    params.push(repId);
  }

  sql += ' ORDER BY v.created_at DESC';
  const rows = db.prepare(sql).all(...params);
  console.log('[getTeamVisits] userId:', managerId, '| manager_id in WHERE:', params[0], '| rows returned:', rows.length);
  return rows;
}

// GET /manager — dashboard
router.get('/manager', isAuthenticated, requireRole('manager'), (req, res) => {
  const managerId = req.session.user.id;
  console.log('[GET /manager] session user id:', req.session.user.id, '| managerId:', managerId);

  const reps = db.prepare(
    "SELECT id, name FROM users WHERE manager_id = ? AND role = 'sales_rep' AND is_active = 1 ORDER BY name"
  ).all(managerId);

  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const from = req.query.from || weekAgo.toISOString().split('T')[0];
  const to = req.query.to || today.toISOString().split('T')[0];
  const repId = req.query.rep_id || '';

  const visits = getTeamVisits(managerId, { from, to, repId });

  res.render('manager', {
    title: 'Manager Dashboard',
    reps,
    visits,
    filters: { from, to, repId }
  });
});

// GET /manager/export — CSV export
router.get('/manager/export', isAuthenticated, requireRole('manager'), (req, res) => {
  console.log('MANAGER EXPORT DEBUG:', 'user id:', req.session.user.id, 'user role:', req.session.user.role);
  const managerId = req.session.user.id;
  console.log('[GET /manager/export] session user id:', req.session.user.id, '| managerId:', managerId);
  const { from, to, rep_id: repId } = req.query;
  const visits = getTeamVisits(managerId, { from, to, repId });
  console.log('ROWS FOUND:', visits.length);

  const csv = generateVisitsCsv(visits);
  const dateStr = new Date().toISOString().split('T')[0];

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=team_visits_${dateStr}.csv`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(csv);
});

module.exports = router;
