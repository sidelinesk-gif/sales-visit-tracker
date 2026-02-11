require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');

const initDB = require('./db/init');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize database
initDB();

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Session
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false,
    maxAge: 1000 * 60 * 60 * 24 // 24 hours
  }
}));

// Make session user available in all views
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

// Routes
const authRoutes = require('./routes/auth');
const visitRoutes = require('./routes/visit');
const managerRoutes = require('./routes/manager');
const adminRoutes = require('./routes/admin');
app.use('/', authRoutes);
app.use('/', visitRoutes);
app.use('/', managerRoutes);
app.use('/', adminRoutes);

// Root redirect
const ROLE_REDIRECTS = { admin: '/admin', manager: '/manager', sales_rep: '/visit' };
app.get('/', (req, res) => {
  if (req.session && req.session.user) {
    return res.redirect(ROLE_REDIRECTS[req.session.user.role] || '/login');
  }
  res.redirect('/login');
});

// 404 handler
app.use((req, res) => {
  res.status(404).render('404', { title: 'Page Not Found' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).render('error', {
    title: 'Error',
    message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : err.message
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

module.exports = app;
