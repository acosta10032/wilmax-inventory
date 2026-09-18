const bcrypt = require('bcryptjs');
const db = require('./index');

function seedUsers() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) return;
  const hash = bcrypt.hashSync('changeme123', 10);
  db.prepare(`INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)`)
    .run('admin', hash, 'Admin', 'admin');
  console.log('Created default login -> username: admin  password: changeme123 (change this after first login)');
}

function seedCatalog() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM items').get().n;
  if (count > 0) return;

  const categories = [
    { name: 'Beverages', color: '#d4a017' },
    { name: 'Dry Goods', color: '#c98b3f' },
    { name: 'Produce', color: '#7fae52' },
    { name: 'Meat & Seafood', color: '#c1543a' },
    { name: 'Cleaning & Supplies', color: '#5a8fbb' },
  ];
  const insertCategory = db.prepare('INSERT INTO categories (name, color) VALUES (?, ?)');
  const categoryIds = {};
  for (const c of categories) {
    const info = insertCategory.run(c.name, c.color);
    categoryIds[c.name] = info.lastInsertRowid;
  }

  const items = [
    { sku: 'BEV-001', name: 'House Red Wine (bottle)', category: 'Beverages', quantity: 42, unit: 'bottle', reorder_level: 12, unit_cost: 9.5, unit_price: 28 },
    { sku: 'BEV-002', name: 'Sparkling Water (case)', category: 'Beverages', quantity: 8, unit: 'case', reorder_level: 10, unit_cost: 14, unit_price: 0 },
    { sku: 'DRY-001', name: 'Penne Pasta 5lb', category: 'Dry Goods', quantity: 26, unit: 'bag', reorder_level: 8, unit_cost: 6.2, unit_price: 0 },
    { sku: 'DRY-002', name: 'San Marzano Tomatoes', category: 'Dry Goods', quantity: 6, unit: 'can', reorder_level: 15, unit_cost: 3.1, unit_price: 0 },
    { sku: 'PRO-001', name: 'Roma Tomatoes', category: 'Produce', quantity: 18, unit: 'lb', reorder_level: 10, unit_cost: 1.8, unit_price: 0 },
    { sku: 'PRO-002', name: 'Fresh Basil', category: 'Produce', quantity: 3, unit: 'bunch', reorder_level: 6, unit_cost: 2.4, unit_price: 0 },
    { sku: 'MEA-001', name: 'Chicken Breast', category: 'Meat & Seafood', quantity: 34, unit: 'lb', reorder_level: 20, unit_cost: 3.9, unit_price: 0 },
    { sku: 'MEA-002', name: 'Shrimp 16/20', category: 'Meat & Seafood', quantity: 9, unit: 'lb', reorder_level: 12, unit_cost: 11.5, unit_price: 0 },
    { sku: 'CLN-001', name: 'Degreaser Spray', category: 'Cleaning & Supplies', quantity: 15, unit: 'bottle', reorder_level: 5, unit_cost: 4.75, unit_price: 0 },
    { sku: 'CLN-002', name: 'Paper Towel Rolls', category: 'Cleaning & Supplies', quantity: 4, unit: 'case', reorder_level: 6, unit_cost: 22, unit_price: 0 },
  ];

  const insertItem = db.prepare(`
    INSERT INTO items (sku, name, category_id, quantity, unit, reorder_level, unit_cost, unit_price)
    VALUES (@sku, @name, @category_id, @quantity, @unit, @reorder_level, @unit_cost, @unit_price)
  `);
  const insertMovement = db.prepare(`
    INSERT INTO stock_movements (item_id, change_qty, balance_after, reason, source, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now', ?))
  `);

  for (const item of items) {
    const info = insertItem.run({ ...item, category_id: categoryIds[item.category] });
    insertMovement.run(info.lastInsertRowid, item.quantity, item.quantity, 'initial-stock', 'seed', '-0 days');

    // Sprinkle a bit of outflow history over the last 2 weeks so the
    // dashboard charts have something to show on first run.
    let running = item.quantity;
    const events = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < events; i += 1) {
      const daysAgo = Math.floor(Math.random() * 14) + 1;
      const out = Math.max(1, Math.round(item.quantity * (0.03 + Math.random() * 0.08)));
      running += out; // walk backwards: this much was on hand before it left
      insertMovement.run(info.lastInsertRowid, -out, running - out, 'sale-deduction', 'seed', `-${daysAgo} days`);
    }
  }
  console.log('Seeded demo categories and inventory items.');
}

seedUsers();
seedCatalog();
console.log('Seed complete.');
