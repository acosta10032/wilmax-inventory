const express = require('express');
const db = require('../db');

const router = express.Router();

// High-level KPIs for the dashboard header.
router.get('/summary', (req, res) => {
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS item_count,
      COALESCE(SUM(quantity), 0) AS total_units,
      COALESCE(SUM(quantity * unit_cost), 0) AS total_cost_value,
      COALESCE(SUM(quantity * unit_price), 0) AS total_retail_value
    FROM items WHERE active = 1
  `).get();
  const lowStock = db.prepare(`SELECT COUNT(*) AS n FROM items WHERE active = 1 AND quantity <= reorder_level AND quantity > 0`).get().n;
  const outOfStock = db.prepare(`SELECT COUNT(*) AS n FROM items WHERE active = 1 AND quantity <= 0`).get().n;
  const categoryCount = db.prepare(`SELECT COUNT(*) AS n FROM categories`).get().n;
  res.json({ ...totals, lowStock, outOfStock, categoryCount });
});

// Stock value broken down by category — feeds the 3D bar chart.
router.get('/by-category', (req, res) => {
  const rows = db.prepare(`
    SELECT c.name, c.color,
           COALESCE(SUM(i.quantity * i.unit_cost), 0) AS cost_value,
           COALESCE(SUM(i.quantity), 0) AS units
    FROM categories c
    LEFT JOIN items i ON i.category_id = c.id AND i.active = 1
    GROUP BY c.id
    HAVING units > 0 OR cost_value > 0
    ORDER BY cost_value DESC
  `).all();
  res.json(rows);
});

// Movement (outflow) over the last N days — proxy for "sales info" without
// a live POS feed: every negative movement is treated as an outflow event.
router.get('/movement-trend', (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 30, 7), 180);
  const rows = db.prepare(`
    SELECT date(created_at) AS day,
           SUM(CASE WHEN change_qty < 0 THEN -change_qty ELSE 0 END) AS outflow,
           SUM(CASE WHEN change_qty > 0 THEN change_qty ELSE 0 END) AS inflow
    FROM stock_movements
    WHERE created_at >= datetime('now', ?)
    GROUP BY day
    ORDER BY day ASC
  `).all(`-${days} days`);
  res.json(rows);
});

// Fastest-moving items by total outflow — the "top movers" chart.
router.get('/top-movers', (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 30, 7), 180);
  const limit = Math.min(Number(req.query.limit) || 8, 20);
  const rows = db.prepare(`
    SELECT i.id, i.name, i.sku,
           SUM(CASE WHEN m.change_qty < 0 THEN -m.change_qty ELSE 0 END) AS outflow
    FROM stock_movements m
    JOIN items i ON i.id = m.item_id
    WHERE m.created_at >= datetime('now', ?)
    GROUP BY i.id
    HAVING outflow > 0
    ORDER BY outflow DESC
    LIMIT ?
  `).all(`-${days} days`, limit);
  res.json(rows);
});

router.get('/import-history', (req, res) => {
  res.json(db.prepare('SELECT * FROM import_batches ORDER BY imported_at DESC LIMIT 25').all());
});

module.exports = router;
