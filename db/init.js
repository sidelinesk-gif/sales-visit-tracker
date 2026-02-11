const db = require('./db');
const bcrypt = require('bcryptjs');

function initialize() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','manager','sales_rep')),
      manager_id INTEGER REFERENCES users(id),
      device_fingerprint TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      geo_radius INTEGER DEFAULT 50,
      status TEXT DEFAULT 'Existing' CHECK(status IN ('Existing','New')),
      approved INTEGER DEFAULT 1,
      created_by INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS client_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sales_rep_id INTEGER REFERENCES users(id),
      client_id INTEGER REFERENCES clients(id),
      UNIQUE(sales_rep_id, client_id)
    );

    CREATE TABLE IF NOT EXISTS visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Add location_name columns if they don't exist
  const clientCols = db.pragma('table_info(clients)').map(c => c.name);
  if (!clientCols.includes('location_name')) {
    db.exec('ALTER TABLE clients ADD COLUMN location_name TEXT');
  }
  const visitCols = db.pragma('table_info(visits)').map(c => c.name);
  if (!visitCols.includes('visit_location_name')) {
    db.exec('ALTER TABLE visits ADD COLUMN visit_location_name TEXT');
  }

  // Seed default admin if no users exist
  const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get();
  if (userCount.count === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare(
      'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)'
    ).run('Admin', 'admin@company.com', hash, 'admin');
    console.log('Default admin seeded: admin@company.com / admin123');
  }
}

module.exports = initialize;
