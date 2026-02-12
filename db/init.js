const pool = require('./db');
const bcrypt = require('bcryptjs');

async function initialize() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','manager','sales_rep')),
      manager_id INTEGER REFERENCES users(id),
      device_fingerprint TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS clients (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      geo_radius INTEGER DEFAULT 50,
      status TEXT DEFAULT 'Existing' CHECK(status IN ('Existing','New')),
      approved INTEGER DEFAULT 1,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      location_name TEXT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS client_assignments (
      id SERIAL PRIMARY KEY,
      sales_rep_id INTEGER REFERENCES users(id),
      client_id INTEGER REFERENCES clients(id),
      UNIQUE(sales_rep_id, client_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS visits (
      id SERIAL PRIMARY KEY,
      sales_rep_id INTEGER REFERENCES users(id),
      client_id INTEGER REFERENCES clients(id),
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      accuracy REAL,
      distance_from_client REAL,
      within_geofence INTEGER,
      visit_purpose TEXT,
      notes TEXT,
      selfie_path TEXT,
      device_fingerprint TEXT,
      system_flag TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      visit_location_name TEXT
    );
  `);

  // Seed default admin if no users exist
  const result = await pool.query('SELECT COUNT(*) AS count FROM users');
  if (parseInt(result.rows[0].count) === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    await pool.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4)',
      ['Admin', 'admin@company.com', hash, 'admin']
    );
    console.log('Default admin seeded: admin@company.com / admin123');
  }
}

module.exports = initialize;
