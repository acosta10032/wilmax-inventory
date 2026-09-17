const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const db = require('../db');
const { recordMovement } = require('./items');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Column names we try to auto-detect in a Wilmax (or any) exported report.
// Wilmax has no API, so this is the sanctioned path: from Inventario -> "..."
// menu -> "Exportar a Excel", then upload that file here to bring stock
// counts up to date. Confirmed against a live Wilmax "Inventario" screen,
// whose columns are: Id del articulo, Codigo de Barras, Nombre, Categoria,
// Tamano, Costo, Precio de venta, Cantidad.
const HEADER_ALIASES = {
  sku: ['sku', 'codigo', 'código', 'code', 'referencia', 'ref', 'id del articulo', 'id del artículo',
        'codigo de barras', 'código de barras', 'barcode'],
  name: ['nombre', 'name', 'producto', 'descripcion', 'descripción', 'item', 'articulo', 'artículo'],
  quantity: ['cantidad', 'existencia', 'existencias', 'stock', 'qty', 'quantity', 'disponible'],
  unit_cost: ['costo', 'cost', 'precio costo', 'unit cost'],
  unit_price: ['precio', 'price', 'precio venta', 'precio de venta', 'unit price', 'venta'],
  category: ['categoria', 'categoría', 'category', 'departamento'],
  size: ['tamano', 'tamaño', 'size'],
};

function detectColumns(headerRow) {
  const map = {};
  headerRow.forEach((raw, idx) => {
    if (!raw) return;
    const norm = String(raw).trim().toLowerCase();
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.includes(norm) && map[field] === undefined) {
        map[field] = idx;
      }
    }
  });
  return map;
}

// POST /api/import/preview — parse the file and show a mapping + row count
// before anything touches the database.
router.post('/preview', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) return res.status(400).json({ error: 'The workbook has no sheets.' });

    const headerRow = sheet.getRow(1).values.slice(1).map((v) => (v && v.text ? v.text : v));
    const columns = detectColumns(headerRow);
    const rows = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const values = row.values.slice(1);
      if (values.every((v) => v === null || v === undefined || v === '')) return;
      rows.push(values);
    });

    res.json({
      headerRow,
      columns,
      rowCount: rows.length,
      sample: rows.slice(0, 5),
      token: req.file.buffer.toString('base64'),
      filename: req.file.originalname,
    });
  } catch (err) {
    res.status(400).json({ error: `Could not read that file: ${err.message}` });
  }
});

// POST /api/import/commit — apply the mapped columns, matching existing
// items by SKU (falling back to exact name match) and updating quantity /
// cost / price. Unmatched rows create new items so nothing is dropped.
router.post('/commit', async (req, res) => {
  const { token, mapping, filename, createMissing = true } = req.body || {};
  if (!token || !mapping || mapping.name === undefined) {
    return res.status(400).json({ error: 'Missing file data or column mapping.' });
  }
  try {
    const buffer = Buffer.from(token, 'base64');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0];

    let matched = 0;
    let created = 0;
    let unmatched = 0;
    let total = 0;

    const findBySku = db.prepare('SELECT * FROM items WHERE sku = ?');
    const findByName = db.prepare('SELECT * FROM items WHERE lower(name) = lower(?)');
    const insertItem = db.prepare(`
      INSERT INTO items (sku, name, quantity, unit_cost, unit_price)
      VALUES (?, ?, ?, ?, ?)
    `);
    const updateStock = db.prepare(`
      UPDATE items SET quantity = ?, unit_cost = COALESCE(?, unit_cost), unit_price = COALESCE(?, unit_price), updated_at = datetime('now')
      WHERE id = ?
    `);

    const run = db.transaction((rows) => {
      for (const values of rows) {
        const get = (field) => {
          const idx = mapping[field];
          if (idx === undefined || idx === null) return undefined;
          const cell = values[idx];
          return cell && cell.text !== undefined ? cell.text : cell;
        };
        const name = get('name');
        if (!name || !String(name).trim()) continue;
        total += 1;

        const sku = get('sku') ? String(get('sku')).trim() : null;
        const qtyRaw = get('quantity');
        const quantity = qtyRaw !== undefined && qtyRaw !== null && qtyRaw !== '' ? Number(qtyRaw) : undefined;
        const costRaw = get('unit_cost');
        const priceRaw = get('unit_price');

        let item = sku ? findBySku.get(sku) : undefined;
        if (!item) item = findByName.get(String(name).trim());

        if (item) {
          matched += 1;
          const newQty = quantity !== undefined && !Number.isNaN(quantity) ? quantity : item.quantity;
          updateStock.run(
            newQty,
            costRaw !== undefined && costRaw !== '' ? Number(costRaw) : null,
            priceRaw !== undefined && priceRaw !== '' ? Number(priceRaw) : null,
            item.id
          );
          if (newQty !== item.quantity) {
            recordMovement({
              itemId: item.id,
              changeQty: newQty - item.quantity,
              balanceAfter: newQty,
              reason: 'import',
              note: `Imported from ${filename || 'file'}`,
              source: 'wilmax-export',
            });
          }
        } else if (createMissing) {
          created += 1;
          const q = quantity !== undefined && !Number.isNaN(quantity) ? quantity : 0;
          const info = insertItem.run(
            sku,
            String(name).trim(),
            q,
            costRaw ? Number(costRaw) : 0,
            priceRaw ? Number(priceRaw) : 0
          );
          if (q) {
            recordMovement({
              itemId: info.lastInsertRowid,
              changeQty: q,
              balanceAfter: q,
              reason: 'import',
              note: `Created from ${filename || 'file'}`,
              source: 'wilmax-export',
            });
          }
        } else {
          unmatched += 1;
        }
      }
    });

    const rows = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const values = row.values.slice(1);
      if (values.every((v) => v === null || v === undefined || v === '')) return;
      rows.push(values);
    });
    run(rows);

    db.prepare(`
      INSERT INTO import_batches (filename, total_rows, matched_count, created_count, unmatched_count, status)
      VALUES (?, ?, ?, ?, ?, 'completed')
    `).run(filename || 'unknown.xlsx', total, matched, created, unmatched);

    res.json({ total, matched, created, unmatched });
  } catch (err) {
    res.status(400).json({ error: `Import failed: ${err.message}` });
  }
});

module.exports = router;
