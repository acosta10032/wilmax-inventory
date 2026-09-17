require('dotenv').config();
const path = require('path');
const express = require('express');
const cookieSession = require('cookie-session');

const bcrypt = require('bcryptjs');
const db = require('./db');
const { requireAuth } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const itemRoutes = require('./routes/items');
const categoryRoutes = require('./routes/categories');
const importRoutes = require('./routes/import');
const reportRoutes = require('./routes/reports');

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.SESSION_SECRET && process.env.NODE_ENV === 'production') {
  console.warn('WARNING: SESSION_SECRET is not set. Set it in your Railway environment variables.');
}

app.use(express.json({ limit: '15mb' }));
app.use(cookieSession({
  name: 'wilmax_inv_session',
  keys: [process.env.SESSION_SECRET || 'dev-secret-change-me'],
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  sameSite: 'lax',
}));

app.use('/api/auth', authRoutes);
app.use('/api/items', requireAuth, itemRoutes);
app.use('/api/categories', requireAuth, categoryRoutes);
app.use('/api/import', requireAuth, importRoutes);
app.use('/api/reports', requireAuth, reportRoutes);

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

// Make sure there's always at least one login. Safe to run on every boot —
// it only acts when the users table is empty.
(function ensureDefaultAdmin() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) return;
  const hash = bcrypt.hashSync('changeme123', 10);
  db.prepare('INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)')
    .run('admin', hash, 'Admin', 'admin');
  console.log('No users found — created default login: admin / changeme123 (change this after first login).');
})();

app.listen(PORT, () => {
  console.log(`Wilmax Inventory running on port ${PORT}`);
});
