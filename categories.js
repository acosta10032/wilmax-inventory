const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT c.id, c.name, c.color, COUNT(i.id) AS item_count,
           COALESCE(SUM(i.quantity * i.unit_cost), 0) AS stock_value
    FROM categories c
    LEFT JOIN items i ON i.category_id = c.id AND i.active = 1
    GROUP BY c.id
    ORDER BY c.name COLLATE NOCASE
  `).all();
  res.json(rows);
});

router.post('/', (req, res) => {
  const { name, color } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Category name is required.' });
  try {
    const info = db.prepare('INSERT INTO categories (name, color) VALUES (?, ?)')
      .run(name.trim(), color || '#d4a017');
    res.status(201).json(db.prepare('SELECT * FROM categories WHERE id = ?').get(info.lastInsertRowid));
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'A category with that name already exists.' });
    }
    throw err;
  }
});

router.put('/:id', (req, res) => {
  const { name, color } = req.body || {};
  const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Category not found.' });
  db.prepare('UPDATE categories SET name = ?, color = ? WHERE id = ?')
    .run(name || existing.name, color || existing.color, req.params.id);
  res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Category not found.' });
  db.prepare('UPDATE items SET category_id = NULL WHERE category_id = ?').run(req.params.id);
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
