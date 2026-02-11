const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/db');
const router = express.Router();

const ROLE_REDIRECTS = {
  admin: '/admin',
  manager: '/manager',
  sales_rep: '/visit'
};

router.get('/login', (req, res) => {
  if (req.session && req.session.user) {
    return res.redirect(ROLE_REDIRECTS[req.session.user.role] || '/');
  }
  res.render('login', { title: 'Login', error: null });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.render('login', { title: 'Login', error: 'Email and password are required.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());

  if (!user) {
    return res.render('login', { title: 'Login', error: 'Invalid email or password.' });
  }

  if (!user.is_active) {
    return res.render('login', { title: 'Login', error: 'Account is deactivated. Contact admin.' });
  }

  if (!bcrypt.compareSync(password, user.password_hash)) {
    return res.render('login', { title: 'Login', error: 'Invalid email or password.' });
  }

  req.session.user = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    manager_id: user.manager_id
  };

  res.redirect(ROLE_REDIRECTS[user.role] || '/');
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

module.exports = router;
