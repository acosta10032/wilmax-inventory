(() => {
  'use strict';

  const state = {
    user: null,
    categories: [],
    items: [],
    currentView: 'dashboard',
    pendingImport: null, // { token, filename, columns }
    adjustingItemId: null,
    moversDays: 30,
  };

  // Inline SVG icons — avoids relying on an emoji font being installed,
  // so these render crisply on every OS/browser instead of showing tofu boxes.
  const ICON_EDIT = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
  const ICON_TRASH = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';
  const ICON_ADJUST = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9h14M5 15h14"/></svg>';

  // ---------------------------------------------------------------------
  // API helper
  // ---------------------------------------------------------------------
  async function api(path, options = {}) {
    const res = await fetch(`/api${path}`, {
      method: options.method || 'GET',
      headers: options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
      body: options.body
        ? (options.body instanceof FormData ? options.body : JSON.stringify(options.body))
        : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      throw new Error((data && data.error) || `Request failed (${res.status})`);
    }
    return data;
  }

  function money(n) {
    return '$' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function num(n) {
    return Number(n || 0).toLocaleString();
  }

  function toast(message, isError) {
    const el = document.createElement('div');
    el.className = 'toast' + (isError ? ' error' : '');
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3800);
  }

  // ---------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------
  const loginScreen = document.getElementById('loginScreen');
  const shell = document.getElementById('shell');

  async function checkSession() {
    try {
      const me = await api('/auth/me');
      state.user = me;
      showShell();
    } catch (e) {
      showLogin();
    }
  }

  function showLogin() {
    loginScreen.style.display = 'flex';
    shell.style.display = 'none';
  }

  function showShell() {
    loginScreen.style.display = 'none';
    shell.style.display = 'flex';
    document.getElementById('userName').textContent = state.user.displayName || state.user.username;
    document.getElementById('userAvatar').textContent = (state.user.displayName || state.user.username || '?')[0].toUpperCase();
    bootData();
  }

  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const errBox = document.getElementById('loginError');
    errBox.style.display = 'none';
    try {
      const user = await api('/auth/login', { method: 'POST', body: { username, password } });
      state.user = user;
      showShell();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.style.display = 'block';
    }
  });

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST' });
    state.user = null;
    showLogin();
  });

  document.getElementById('passwordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const currentPassword = document.getElementById('curPass').value;
    const newPassword = document.getElementById('newPass').value;
    try {
      await api('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } });
      toast('Password updated.');
      e.target.reset();
    } catch (err) {
      toast(err.message, true);
    }
  });

  // ---------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------
  const viewMeta = {
    dashboard: { title: 'Dashboard', sub: 'Overview of your stock' },
    inventory: { title: 'Inventory', sub: 'Every item you track' },
    import: { title: 'Import from Wilmax', sub: 'Bring stock counts up to date from an exported report' },
    reports: { title: 'Reports', sub: 'Movement and value over time' },
    settings: { title: 'Settings', sub: 'Your account' },
  };

  document.querySelectorAll('.nav-item[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  function switchView(view) {
    state.currentView = view;
    document.querySelectorAll('.nav-item[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
    document.getElementById('viewTitle').textContent = viewMeta[view].title;
    document.getElementById('viewSub').textContent = viewMeta[view].sub;
    if (view === 'dashboard') renderDashboard();
    if (view === 'inventory') renderInventory();
    if (view === 'reports') renderReports();
    if (view === 'import') loadImportHistory();
  }

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  async function bootData() {
    await refreshCategories();
    switchView('dashboard');
  }

  async function refreshCategories() {
    state.categories = await api('/categories');
    const sel = document.getElementById('invCategoryFilter');
    const cur = sel.value;
    sel.innerHTML = '<option value="">All categories</option>' +
      state.categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    sel.value = cur;
    const fCat = document.getElementById('fCategory');
    fCat.innerHTML = '<option value="">No category</option>' +
      state.categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  // ---------------------------------------------------------------------
  // 3D chart helpers (ECharts + echarts-gl)
  // ---------------------------------------------------------------------
  const GOLD_TOP = '#ffd580';
  const GOLD_BOTTOM = '#8a6a2b';

  function goldGradient() {
    return new echarts.graphic.LinearGradient(0, 0, 0, 1, [
      { offset: 0, color: GOLD_TOP },
      { offset: 1, color: GOLD_BOTTOM },
    ]);
  }

  function bar3D(domId, categories, values, opts = {}) {
    const el = document.getElementById(domId);
    if (!el) return null;
    const chart = echarts.getInstanceByDom(el) || echarts.init(el, null, { renderer: 'canvas' });
    if (!categories.length) {
      chart.clear();
      return chart;
    }
    chart.setOption({
      tooltip: {
        formatter: (p) => `${categories[p.value[0]]}<br/><strong>${opts.tooltipFmt ? opts.tooltipFmt(p.value[2]) : p.value[2]}</strong>`,
        backgroundColor: '#1c2030', borderColor: '#262b3a', textStyle: { color: '#eef0f6' },
      },
      visualMap: {
        show: false, min: 0, max: Math.max(...values, 1),
        inRange: { color: ['#5a4318', '#e7b34a', '#ffe1a3'] },
      },
      xAxis3D: { type: 'category', name: '', data: categories, axisLabel: { textStyle: { color: '#9aa0b4', fontSize: 10 }, interval: 0, rotate: categories.length > 5 ? 35 : 0 }, axisLine: { lineStyle: { color: '#262b3a' } } },
      yAxis3D: { type: 'category', name: '', data: [''], axisLabel: { show: false } },
      zAxis3D: { type: 'value', name: '', axisLabel: { textStyle: { color: '#9aa0b4', fontSize: 10 } }, axisLine: { lineStyle: { color: '#262b3a' } }, splitLine: { lineStyle: { color: '#1c2030' } } },
      grid3D: {
        boxWidth: Math.min(220, categories.length * 28 + 40),
        boxDepth: 26,
        boxHeight: 60,
        viewControl: { autoRotate: true, autoRotateSpeed: 3, distance: 170, alpha: 16, beta: 25, damping: 0.85 },
        light: {
          main: { intensity: 1.3, shadow: true, shadowQuality: 'medium', alpha: 30 },
          ambient: { intensity: 0.35 },
        },
        environment: 'transparent',
        postEffect: { enable: false },
      },
      series: [{
        type: 'bar3D',
        data: values.map((v, i) => [i, 0, v]),
        shading: 'lambert',
        barSize: Math.max(6, Math.min(16, 130 / categories.length)),
        itemStyle: { opacity: 0.95 },
        emphasis: { itemStyle: { color: '#ffe1a3' } },
      }],
    });
    return chart;
  }

  function trendChart(domId, days) {
    const el = document.getElementById(domId);
    const chart = echarts.getInstanceByDom(el) || echarts.init(el);
    const labels = days.map((d) => d.day);
    chart.setOption({
      tooltip: { trigger: 'axis', backgroundColor: '#1c2030', borderColor: '#262b3a', textStyle: { color: '#eef0f6' } },
      legend: { data: ['Inflow', 'Outflow'], textStyle: { color: '#9aa0b4' }, top: 0 },
      grid: { left: 40, right: 16, top: 34, bottom: 28 },
      xAxis: { type: 'category', data: labels, axisLine: { lineStyle: { color: '#262b3a' } }, axisLabel: { color: '#656b80', fontSize: 10 } },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: '#1c2030' } }, axisLabel: { color: '#656b80', fontSize: 10 } },
      series: [
        {
          name: 'Inflow', type: 'line', smooth: true, symbol: 'none', data: days.map((d) => d.inflow),
          lineStyle: { color: '#4fbf7f', width: 2 },
          areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(79,191,127,0.25)' }, { offset: 1, color: 'rgba(79,191,127,0)' }]) },
        },
        {
          name: 'Outflow', type: 'line', smooth: true, symbol: 'none', data: days.map((d) => d.outflow),
          lineStyle: { color: '#e7b34a', width: 2 },
          areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(231,179,74,0.25)' }, { offset: 1, color: 'rgba(231,179,74,0)' }]) },
        },
      ],
    });
    return chart;
  }

  function resizeAllCharts() {
    ['chart3dCategory', 'chart3dPie', 'chartTrend', 'chart3dMovers', 'chartReportCategory', 'chartReportTrend'].forEach((id) => {
      const el = document.getElementById(id);
      const inst = el && echarts.getInstanceByDom(el);
      if (inst) inst.resize();
    });
  }
  window.addEventListener('resize', debounce(resizeAllCharts, 150));

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  // ---------------------------------------------------------------------
  // Dashboard
  // ---------------------------------------------------------------------
  async function renderDashboard() {
    const [summary, byCategory, trend] = await Promise.all([
      api('/reports/summary'),
      api('/reports/by-category'),
      api('/reports/movement-trend?days=30'),
    ]);

    document.getElementById('kpiItems').textContent = num(summary.item_count);
    document.getElementById('kpiItemsSub').textContent = `${num(summary.total_units)} total units`;
    document.getElementById('kpiValue').textContent = money(summary.total_cost_value);
    document.getElementById('kpiValueSub').textContent = `${money(summary.total_retail_value)} at retail`;
    document.getElementById('kpiLow').textContent = num(summary.lowStock);
    document.getElementById('kpiOut').textContent = num(summary.outOfStock);

    bar3D('chart3dCategory', byCategory.map((c) => c.name), byCategory.map((c) => c.cost_value), { tooltipFmt: money });
    bar3D('chart3dPie', byCategory.map((c) => c.name), byCategory.map((c) => c.units), { tooltipFmt: num });
    trendChart('chartTrend', trend);

    const low = await api('/items?status=low');
    const out = await api('/items?status=out');
    const attention = [...out, ...low.filter((i) => i.quantity > 0)].slice(0, 8);
    const list = document.getElementById('lowStockList');
    if (!attention.length) {
      list.innerHTML = '<div class="empty-state">Nothing needs attention right now.</div>';
    } else {
      list.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Item</th><th>Category</th><th>Qty</th><th>Reorder Level</th><th>Status</th></tr></thead><tbody>` +
        attention.map((i) => `
          <tr>
            <td>${escapeHtml(i.name)}</td>
            <td>${escapeHtml(i.category_name || '—')}</td>
            <td>${num(i.quantity)} ${escapeHtml(i.unit || '')}</td>
            <td>${num(i.reorder_level)}</td>
            <td>${statusBadge(i)}</td>
          </tr>
        `).join('') + '</tbody></table></div>';
    }
  }

  function statusBadge(item) {
    if (item.quantity <= 0) return '<span class="badge out">Out of stock</span>';
    if (item.quantity <= item.reorder_level) return '<span class="badge low">Low</span>';
    return '<span class="badge ok">In stock</span>';
  }

  // ---------------------------------------------------------------------
  // Inventory
  // ---------------------------------------------------------------------
  const invSearch = document.getElementById('invSearch');
  const invCategoryFilter = document.getElementById('invCategoryFilter');
  const invStatusFilter = document.getElementById('invStatusFilter');
  [invSearch, invCategoryFilter, invStatusFilter].forEach((el) => {
    el.addEventListener('input', debounce(renderInventory, 200));
    el.addEventListener('change', renderInventory);
  });

  async function renderInventory() {
    const params = new URLSearchParams();
    if (invSearch.value.trim()) params.set('q', invSearch.value.trim());
    if (invCategoryFilter.value) params.set('category', invCategoryFilter.value);
    if (invStatusFilter.value) params.set('status', invStatusFilter.value);
    const items = await api(`/items?${params.toString()}`);
    state.items = items;
    const tbody = document.getElementById('invTableBody');
    const empty = document.getElementById('invEmpty');
    if (!items.length) {
      tbody.innerHTML = '';
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';
    tbody.innerHTML = items.map((i) => `
      <tr>
        <td><strong>${escapeHtml(i.name)}</strong></td>
        <td>${escapeHtml(i.sku || '—')}</td>
        <td>${i.category_name ? `<span class="dot" style="background:${i.category_color}"></span> ${escapeHtml(i.category_name)}` : '—'}</td>
        <td>
          <div class="qty-controls">
            <button data-adjust="${i.id}" data-delta="-1">−</button>
            <span>${num(i.quantity)} ${escapeHtml(i.unit || '')}</span>
            <button data-adjust="${i.id}" data-delta="1">+</button>
          </div>
        </td>
        <td>${statusBadge(i)}</td>
        <td>${money(i.unit_cost)}</td>
        <td>${money(i.unit_price)}</td>
        <td>${money(i.quantity * i.unit_cost)}</td>
        <td>
          <div class="row-actions">
            <button class="icon-btn" data-adjust-open="${i.id}" title="Adjust stock">${ICON_ADJUST}</button>
            <button class="icon-btn" data-edit="${i.id}" title="Edit">${ICON_EDIT}</button>
            <button class="icon-btn" data-delete="${i.id}" title="Remove">${ICON_TRASH}</button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  document.getElementById('invTableBody').addEventListener('click', async (e) => {
    const t = e.target;
    if (t.dataset.adjust) {
      const delta = Number(t.dataset.delta);
      try {
        await api(`/items/${t.dataset.adjust}/adjust`, { method: 'POST', body: { changeQty: delta, reason: 'manual-adjust' } });
        renderInventory();
      } catch (err) { toast(err.message, true); }
    } else if (t.dataset.adjustOpen) {
      openAdjustModal(t.dataset.adjustOpen);
    } else if (t.dataset.edit) {
      openItemModal(t.dataset.edit);
    } else if (t.dataset.delete) {
      if (confirm('Remove this item from inventory?')) {
        try { await api(`/items/${t.dataset.delete}`, { method: 'DELETE' }); renderInventory(); toast('Item removed.'); }
        catch (err) { toast(err.message, true); }
      }
    }
  });

  // ---- Item add/edit modal ----
  const itemModalBackdrop = document.getElementById('itemModalBackdrop');
  function openItemModal(id) {
    document.getElementById('itemForm').reset();
    document.getElementById('itemId').value = '';
    document.getElementById('itemModalTitle').textContent = id ? 'Edit Item' : 'Add Item';
    if (id) {
      const item = state.items.find((i) => String(i.id) === String(id));
      if (item) {
        document.getElementById('itemId').value = item.id;
        document.getElementById('fName').value = item.name || '';
        document.getElementById('fSku').value = item.sku || '';
        document.getElementById('fCategory').value = item.category_id || '';
        document.getElementById('fQuantity').value = item.quantity;
        document.getElementById('fUnit').value = item.unit || '';
        document.getElementById('fReorderLevel').value = item.reorder_level;
        document.getElementById('fUnitCost').value = item.unit_cost;
        document.getElementById('fUnitPrice').value = item.unit_price;
        document.getElementById('fSupplier').value = item.supplier || '';
        document.getElementById('fNotes').value = item.notes || '';
      }
    }
    itemModalBackdrop.classList.add('active');
  }
  document.getElementById('quickAddBtn').addEventListener('click', () => openItemModal(null));
  document.getElementById('itemModalCancel').addEventListener('click', () => itemModalBackdrop.classList.remove('active'));
  itemModalBackdrop.addEventListener('click', (e) => { if (e.target === itemModalBackdrop) itemModalBackdrop.classList.remove('active'); });

  document.getElementById('itemForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('itemId').value;
    const payload = {
      name: document.getElementById('fName').value,
      sku: document.getElementById('fSku').value || null,
      category_id: document.getElementById('fCategory').value || null,
      quantity: document.getElementById('fQuantity').value,
      unit: document.getElementById('fUnit').value || 'unit',
      reorder_level: document.getElementById('fReorderLevel').value || 0,
      unit_cost: document.getElementById('fUnitCost').value || 0,
      unit_price: document.getElementById('fUnitPrice').value || 0,
      supplier: document.getElementById('fSupplier').value || null,
      notes: document.getElementById('fNotes').value || null,
    };
    try {
      if (id) await api(`/items/${id}`, { method: 'PUT', body: payload });
      else await api('/items', { method: 'POST', body: payload });
      itemModalBackdrop.classList.remove('active');
      toast(id ? 'Item updated.' : 'Item added.');
      renderInventory();
      if (state.currentView === 'dashboard') renderDashboard();
    } catch (err) { toast(err.message, true); }
  });

  // ---- Adjust stock modal ----
  const adjustModalBackdrop = document.getElementById('adjustModalBackdrop');
  function openAdjustModal(id) {
    state.adjustingItemId = id;
    const item = state.items.find((i) => String(i.id) === String(id));
    document.getElementById('adjustModalTitle').textContent = item ? `Adjust Stock — ${item.name}` : 'Adjust Stock';
    document.getElementById('adjustForm').reset();
    adjustModalBackdrop.classList.add('active');
  }
  document.getElementById('adjustModalCancel').addEventListener('click', () => adjustModalBackdrop.classList.remove('active'));
  adjustModalBackdrop.addEventListener('click', (e) => { if (e.target === adjustModalBackdrop) adjustModalBackdrop.classList.remove('active'); });
  document.getElementById('adjustForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api(`/items/${state.adjustingItemId}/adjust`, {
        method: 'POST',
        body: {
          changeQty: document.getElementById('adjQty').value,
          reason: document.getElementById('adjReason').value,
          note: document.getElementById('adjNote').value,
        },
      });
      adjustModalBackdrop.classList.remove('active');
      toast('Stock adjusted.');
      renderInventory();
    } catch (err) { toast(err.message, true); }
  });

  // ---- Categories modal ----
  const catModalBackdrop = document.getElementById('catModalBackdrop');
  document.getElementById('manageCategoriesBtn').addEventListener('click', async () => {
    await renderCategoryList();
    catModalBackdrop.classList.add('active');
  });
  document.getElementById('catModalClose').addEventListener('click', () => catModalBackdrop.classList.remove('active'));
  catModalBackdrop.addEventListener('click', (e) => { if (e.target === catModalBackdrop) catModalBackdrop.classList.remove('active'); });

  async function renderCategoryList() {
    const cats = await api('/categories');
    const list = document.getElementById('catList');
    list.innerHTML = cats.map((c) => `
      <div style="display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid var(--border);">
        <span class="dot" style="background:${c.color}"></span>
        <span style="flex:1;">${escapeHtml(c.name)}</span>
        <span class="hint">${c.item_count} items</span>
        <button class="icon-btn" data-del-cat="${c.id}">${ICON_TRASH}</button>
      </div>
    `).join('') || '<div class="empty-state">No categories yet.</div>';
    list.querySelectorAll('[data-del-cat]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (confirm('Delete this category? Items keep their data but lose the category tag.')) {
          await api(`/categories/${btn.dataset.delCat}`, { method: 'DELETE' });
          renderCategoryList();
          refreshCategories();
        }
      });
    });
  }
  document.getElementById('catForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/categories', { method: 'POST', body: { name: document.getElementById('fCatName').value, color: document.getElementById('fCatColor').value } });
      document.getElementById('catForm').reset();
      renderCategoryList();
      refreshCategories();
    } catch (err) { toast(err.message, true); }
  });

  // ---------------------------------------------------------------------
  // Import
  // ---------------------------------------------------------------------
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', () => { if (fileInput.files.length) handleFile(fileInput.files[0]); });

  const FIELD_SELECT_IDS = { name: 'mapName', sku: 'mapSku', quantity: 'mapQuantity', unit_cost: 'mapUnitCost', unit_price: 'mapUnitPrice' };

  async function handleFile(file) {
    const form = new FormData();
    form.append('file', file);
    try {
      const preview = await api('/import/preview', { method: 'POST', body: form });
      state.pendingImport = { token: preview.token, filename: preview.filename, headerRow: preview.headerRow };
      document.getElementById('mappingHint').textContent = `${preview.rowCount} rows found in "${preview.filename}". Auto-matched columns are pre-selected — adjust if anything looks off.`;
      Object.entries(FIELD_SELECT_IDS).forEach(([field, selectId]) => {
        const sel = document.getElementById(selectId);
        sel.innerHTML = '<option value="">— not in file —</option>' +
          preview.headerRow.map((h, idx) => `<option value="${idx}">${escapeHtml(h || `Column ${idx + 1}`)}</option>`).join('');
        if (preview.columns[field] !== undefined) sel.value = preview.columns[field];
      });
      document.getElementById('mappingSection').style.display = 'block';
      document.getElementById('importResult').style.display = 'none';
    } catch (err) {
      toast(err.message, true);
    }
  }

  document.getElementById('cancelImportBtn').addEventListener('click', () => {
    document.getElementById('mappingSection').style.display = 'none';
    fileInput.value = '';
    state.pendingImport = null;
  });

  document.getElementById('commitImportBtn').addEventListener('click', async () => {
    if (!state.pendingImport) return;
    const mapping = {};
    Object.entries(FIELD_SELECT_IDS).forEach(([field, selectId]) => {
      const v = document.getElementById(selectId).value;
      if (v !== '') mapping[field] = Number(v);
    });
    if (mapping.name === undefined) {
      toast('Please map the "Item name" column.', true);
      return;
    }
    try {
      const result = await api('/import/commit', {
        method: 'POST',
        body: { token: state.pendingImport.token, filename: state.pendingImport.filename, mapping, createMissing: document.getElementById('createMissing').checked },
      });
      const box = document.getElementById('importResult');
      box.style.display = 'grid';
      box.innerHTML = `
        <div><div class="n">${result.total}</div><div class="l">Rows read</div></div>
        <div><div class="n">${result.matched}</div><div class="l">Updated</div></div>
        <div><div class="n">${result.created}</div><div class="l">Created</div></div>
        <div><div class="n">${result.unmatched}</div><div class="l">Skipped</div></div>
      `;
      toast('Import complete.');
      fileInput.value = '';
      state.pendingImport = null;
      loadImportHistory();
      refreshCategories();
    } catch (err) {
      toast(err.message, true);
    }
  });

  async function loadImportHistory() {
    const rows = await api('/reports/import-history');
    const tbody = document.getElementById('importHistoryBody');
    tbody.innerHTML = rows.length ? rows.map((r) => `
      <tr>
        <td>${escapeHtml(r.filename)}</td>
        <td>${new Date(r.imported_at + 'Z').toLocaleString()}</td>
        <td>${num(r.total_rows)}</td>
        <td>${num(r.matched_count)}</td>
        <td>${num(r.created_count)}</td>
        <td>${num(r.unmatched_count)}</td>
      </tr>
    `).join('') : '<tr><td colspan="6" class="empty-state">No imports yet.</td></tr>';
  }

  // ---------------------------------------------------------------------
  // Reports
  // ---------------------------------------------------------------------
  document.getElementById('moversRange').addEventListener('click', (e) => {
    if (!e.target.dataset.days) return;
    state.moversDays = Number(e.target.dataset.days);
    document.querySelectorAll('#moversRange button').forEach((b) => b.classList.toggle('active', b === e.target));
    loadMovers();
  });

  async function renderReports() {
    const [byCategory, trend] = await Promise.all([
      api('/reports/by-category'),
      api('/reports/movement-trend?days=60'),
    ]);
    bar3D('chartReportCategory', byCategory.map((c) => c.name), byCategory.map((c) => c.cost_value), { tooltipFmt: money });
    trendChart('chartReportTrend', trend);
    loadMovers();
  }

  async function loadMovers() {
    const movers = await api(`/reports/top-movers?days=${state.moversDays}&limit=10`);
    bar3D('chart3dMovers', movers.map((m) => m.name), movers.map((m) => m.outflow), { tooltipFmt: num });
  }

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------
  checkSession();
})();
