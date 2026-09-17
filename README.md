# Inventory Control

A standalone inventory management dashboard — dark theme, 3D charts, stock
tracking, low-stock alerts — built to receive stock updates from your
**Wilmax POS** exports.

## About the Wilmax "sync"

Wilmax (wilmaxpos.com / wilmaxsoft.com) doesn't publish a public API, and
their terms of service explicitly prohibit automated scripts/bots against
their app. So this system does **not** connect to Wilmax live. Instead, it
uses the export feature that's already built into Wilmax:

1. In Wilmax, go to **Inventario**, click the **⋯** menu (top right), then
   **Exportar a Excel**.
2. In this app, go to **Import from Wilmax**, and drop that file in.
3. The app matches items by SKU/barcode first, then by name, updates
   quantity/cost/price, and adds anything new. Nothing is applied until you
   click **Apply Import**, and you can adjust the column mapping if Wilmax
   ever changes its export format.

This isn't a live, automatic sync — you (or whoever closes out inventory)
export and drop in the file whenever you want counts refreshed (daily,
weekly, whatever fits). If you ever want a real live sync, the only path is
asking Wilmax support directly whether they'll grant API/automated access
to your account — nothing on their site offers it today.

## Running it locally (optional, to try it out first)

You'll need [Node.js](https://nodejs.org) installed (LTS version).

Open PowerShell in this folder and run:

```
npm install
npm run seed      # creates the login + a few demo items so the dashboard isn't empty
npm start
```

Then open http://localhost:3000 — sign in with:

- **Username:** `admin`
- **Password:** `changeme123`

Change that password right away from **Settings** once you're in.

To start over with a totally empty inventory (no demo items), delete the
`data` folder and run `npm start` again — it'll create a fresh database and
a fresh `admin` / `changeme123` login automatically.

## Deploying (same flow as your other POS projects)

1. Create a new GitHub repository and, in **GitHub Desktop**, add this
   folder as a local repository, commit everything, and publish it.
2. In **Railway**, create a new project → **Deploy from GitHub repo** →
   pick this repository. Railway will detect it's a Node app and run
   `npm install` then `npm start` automatically.
3. **Important — set these in Railway under your service's "Variables" tab:**
   - `SESSION_SECRET` — any long random string (this keeps logins secure).
   - `DB_PATH` — see the persistence note below.
4. **Add a Volume so your data survives redeploys.** By default, Railway's
   filesystem resets every time you push an update — which would wipe your
   inventory. In your Railway service, add a **Volume**, mount it at
   `/data`, and set the `DB_PATH` variable to `/data/inventory.db`. Redeploy.
   This is the same idea as a database on your other POS apps — without a
   Volume, a SQLite file has nowhere permanent to live.
5. Once it's live, visit your Railway URL, sign in with
   `admin` / `changeme123`, and change the password immediately from
   **Settings**.

If you skip the Volume step, the app still works, but every time you push a
new change through GitHub Desktop your inventory data will reset to empty —
so don't skip it.

## What's inside

- `src/server.js` — the app server (Express)
- `src/db/` — the database schema and demo-data seeder (SQLite)
- `src/routes/` — the API: items, categories, stock import, reports
- `public/` — the dashboard itself (HTML/CSS/JS), including the 3D charts
  (ECharts + echarts-gl, bundled locally in `public/vendor/` so the app
  doesn't depend on an external CDN being reachable)

## Day-to-day use

- **Dashboard** — stock value, low/out-of-stock counts, 3D charts by
  category, recent movement.
- **Inventory** — search, filter, quick +/- stock buttons, full edit,
  reorder levels.
- **Import from Wilmax** — the file-based sync described above.
- **Reports** — top movers, category value, movement trend, with a
  7/30/90-day toggle.
- **Settings** — change your password.

Stock changes (imports, manual +/-, adjustments) are all logged, which is
what powers the movement charts — so the more you use the +/- buttons or
the "Adjust Stock" reason field instead of just editing quantity directly,
the more useful the Reports page becomes over time.
