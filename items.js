const express = require('express');
const db = require('../db');

const router = express.Router();

function recordMovement({ itemId, changeQty, balanceAfter, reason, note, source, createdBy }) {
  db.prepare(`
    INSERT INTO stock_movements (item_id, change_qty, balance_after, reason, note, source, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(itemId, changeQty, balanceAfter, reason, note || null, source || 'manual', createdBy || null);
}

router.get('/', (req, res) => {
  const { q, category, status } = req.query;
  let sql = `
    SELECT i.*, c.name AS category_name, c.color AS category_color
    FROM items i
    LEFT JOIN categories c ON c.id = i.category_id
    WHERE i.active = 1
  `;
  const params = [];
  if (q) {
    sql += ' AND (i.name LIKE ? OR i.sku LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }
  if (category) {
    sql += ' AND i.category_id = ?';
    params.push(category);
  }
  if (status === 'low') {
    sql += ' AND i.quantity <= i.reorder_level';
  } else if (status === 'out') {
    sql += ' AND i.quantity <= 0';
  }
  sql += ' ORDER BY i.name COLLATE NOCASE';
  res.json(db.prepare(sql).all(...params));
});

router.get('/:id', (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found.' });
  const movements = db.prepare(`
    SELECT * FROM stock_movements WHERE item_id = ? ORDER BY created_at DESC LIMIT 50
  `).all(req.params.id);
  res.json({ ...item, movements });
});

router.post('/', (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.name.trim()) return res.status(400).json({ error: 'Item name is required.' });
  const quantity = Number(b.quantity) || 0;
  try {
    const info = db.prepare(`
      INSERT INTO items (sku, name, category_id, quantity, unit, reorder_level, unit_cost, unit_price, supplier, location, notes)
      VALUES (@sku, @name, @category_id, @quantity, @unit, @reorder_level, @unit_cost, @unit_price, @supplier, @location, @notes)
    `).run({
      sku: b.sku || null,
      name: b.name.trim(),
      category_id: b.category_id || null,
      quantity,
      unit: b.unit || 'unit',
      reorder_level: Number(b.reorder_level) || 0,
      unit_cost: Number(b.unit_cost) || 0,
      unit_price: Number(b.unit_price) || 0,
      supplier: b.supplier || null,
      location: b.location || null,
      notes: b.notes || null,
    });
    if (quantity !== 0) {
      recordMovement({ itemId: info.lastInsertRowid, changeQty: quantity, balanceAfter: quantity, reason: 'initial-stock', source: 'manual', createdBy: req.session.userId });
    }
    res.status(201).json(db.prepare('SELECT * FROM items WHERE id = ?').get(info.lastInsertRowid));
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'An item with that SKU already exists.' });
    }
    throw err;
  }
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Item not found.' });
  const b = req.body || {};
  const merged = {
    sku: b.sku !== undefined ? b.sku || null : existing.sku,
    name: b.name !== undefined ? b.name.trim() : existing.name,
    category_id: b.category_id !== undefined ? b.category_id || null : existing.category_id,
    unit: b.unit !== undefined ? b.unit : existing.unit,
    reorder_level: b.reorder_level !== undefined ? Number(b.reorder_level) : existing.reorder_level,
    unit_cost: b.unit_cost !== undefined ? Number(b.unit_cost) : existing.unit_cost,
    unit_price: b.unit_price !== undefined ? Number(b.unit_price) : existing.unit_price,
    supplier: b.supplier !== undefined ? b.supplier : existing.supplier,
    location: b.location !== undefined ? b.location : existing.location,
    notes: b.notes !== undefined ? b.notes : existing.notes,
  };
  try {
    db.prepare(`
      UPDATE items SET sku=@sku, name=@name, category_id=@category_id, unit=@unit, reorder_level=@reorder_level,
        unit_cost=@unit_cost, unit_price=@unit_price, supplier=@supplier, location=@location, notes=@notes,
        updated_at = datetime('now')
      WHERE id=@id
    `).run({ ...merged, id: req.params.id });
    res.json(db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id));
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'An item with that SKU already exists.' });
    }
    throw err;
  }
});

router.post('/:id/adjust', (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found.' });
  const { changeQty, reason, note } = req.body || {};
  const delta = Number(changeQty);
  if (!delta || Number.isNaN(delta)) return res.status(400).json({ error: 'changeQty must be a non-zero number.' });
  const newQty = item.quantity + delta;
  db.prepare(`UPDATE items SET quantity = ?, updated_at = datetime('now') WHERE id = ?`).run(newQty, item.id);
  recordMovement({
    itemId: item.id, changeQty: delta, balanceAfter: newQty,
    reason: reason || 'manual-adjust', note, source: 'manual', createdBy: req.session.userId,
  });
  res.json(db.prepare('SELECT * FROM items WHERE id = ?').get(item.id));
});

router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Item not found.' });
  db.prepare('UPDATE items SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
module.exports.recordMovement = recordMovement;
