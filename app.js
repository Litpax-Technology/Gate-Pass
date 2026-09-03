'use strict';

const state = { token: null, name: null, role: null, empId: null, dept: null,
               view: null, page: 1, q: '', status: '', config: {}, lastRows: [] };
let timerInterval = null;

/* ================= JSONP with timeout ================= */
function api(action, params = {}) {
  return new Promise((resolve, reject) => {
    const cb = 'jp_' + Math.random().toString(36).slice(2);
    const s = document.createElement('script');
    const timer = setTimeout(() => { cleanup(); reject(new Error('Network timeout')); }, 20000);
    function cleanup() { clearTimeout(timer); delete window[cb]; s.remove(); }
    window[cb] = (res) => { cleanup(); resolve(res); };
    const all = Object.assign({ action, callback: cb }, params);
    if (state.token) all.token = state.token;
    s.src = CONFIG.API_URL + '?' +
      Object.keys(all).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(all[k])).join('&');
    s.onerror = () => { cleanup(); reject(new Error('Network error')); };
    document.body.appendChild(s);
  });
}

/* ================= Toast ================= */
function toast(msg, ok = true) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast show ' + (ok ? 'ok' : 'bad');
  setTimeout(() => t.className = 'toast', 2600);
}
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

/* ================= Login ================= */
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.getElementById('tab-emp').classList.toggle('hidden', tab !== 'emp');
  document.getElementById('tab-staff').classList.toggle('hidden', tab !== 'staff');
  document.getElementById('loginErr').textContent = '';
}

async function empLogin() {
  const id = document.getElementById('empId').value.trim();
  if (!id) return (document.getElementById('loginErr').textContent = 'Enter your Employee ID');
  const btn = document.getElementById('empLoginBtn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  try {
    const r = await api('empLogin', { empId: id });
    if (!r.ok) return (document.getElementById('loginErr').textContent = r.message || 'Login failed');
    enterApp(r);
  } catch (e) { document.getElementById('loginErr').textContent = e.message; }
  finally { btn.disabled = false; btn.textContent = 'Sign in'; }
}

async function staffLogin() {
  const pin = document.getElementById('pin').value.trim();
  if (!pin) return (document.getElementById('loginErr').textContent = 'Enter your PIN');
  const btn = document.getElementById('staffLoginBtn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  try {
    const r = await api('staffLogin', { pin });
    if (!r.ok) return (document.getElementById('loginErr').textContent = r.message || 'Login failed');
    enterApp(r);
  } catch (e) { document.getElementById('loginErr').textContent = e.message; }
  finally { btn.disabled = false; btn.textContent = 'Sign in'; }
}

async function enterApp(r) {
  state.token = r.token; state.name = r.name; state.role = r.role;
  state.empId = r.empId || null; state.dept = r.department || null;
  document.getElementById('loginView').classList.add('hidden');
  document.getElementById('appView').classList.remove('hidden');
  document.getElementById('whoSide').innerHTML =
    '<strong>' + esc(r.name) + '</strong>' + esc(r.role) + (r.empId ? ' · ' + esc(r.empId) : '');
  try { const c = await api('config'); if (c.ok) state.config = c.config || {}; } catch (e) {}
  buildNav();
}

/* ================= Nav (role-aware) ================= */
function buildNav() {
  const menu = {
    Employee: [ ['new', 'New Gate Pass'], ['mine', 'My Passes'] ],
    HOD:      [ ['approvals', 'Approvals'], ['dash', 'Dashboard'] ],
    Security: [ ['gate', 'Gate Console'] ],
    Admin:    [ ['dash', 'Dashboard'], ['all', 'All Passes'], ['employees', 'Employees'], ['settings', 'Settings'] ]
  };
  const items = menu[state.role] || [];
  document.getElementById('nav').innerHTML = items.map(([id, label]) =>
    `<a class="nav-item" data-id="${id}">${label}<span class="nav-badge hidden" data-badge="${id}"></span></a>`).join('');
  document.querySelectorAll('.nav-item').forEach(a =>
    a.onclick = () => go(a.dataset.id));
  go(items[0][0]);
}

function go(view) {
  state.view = view; state.page = 1; state.q = ''; state.status = '';
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  document.querySelectorAll('.nav-item').forEach(a => a.classList.toggle('active', a.dataset.id === view));
  const titles = { new: 'New Gate Pass', mine: 'My Passes', approvals: 'Pending Approvals',
    gate: 'Gate Console', dash: 'Dashboard', all: 'All Passes', employees: 'Employees', settings: 'Settings' };
  document.getElementById('pageTitle').textContent = titles[view] || '';
  const showSearch = (view === 'all');
  document.getElementById('search').classList.toggle('hidden', !showSearch);
  document.getElementById('exportBtn').classList.toggle('hidden', !showSearch);
  const render = { new: renderNewPass, mine: renderMyPasses, approvals: renderApprovals,
    gate: renderGate, dash: renderDashboard, all: renderAllPasses,
    employees: renderEmployees, settings: renderSettings }[view];
  if (render) render();
}

function loading(n = 4) { document.getElementById('page').innerHTML = '<div class="skeleton"></div>'.repeat(n); }
function options(type) { return (state.config[type] || []).map(o => `<option value="${esc(o.value)}">${esc(o.value)}</option>`).join(''); }

/* ================= Chips / helpers ================= */
function statusChip(s) {
  const map = { Pending: 'pending', Approved: 'approved', Out: 'out', Returned: 'returned', Rejected: 'rejected' };
  return `<span class="chip chip-${map[s] || 'pending'}">${esc(s)}</span>`;
}
function delayChip(row) {
  if (row.Status !== 'Returned' || row.DelayMinutes === '' || row.DelayMinutes === null || row.DelayMinutes === undefined) return '';
  const d = Number(row.DelayMinutes);
  if (isNaN(d)) return '';
  return d > 0 ? `<span class="chip chip-late">+${d} min late</span>`
               : `<span class="chip chip-ontime">On time</span>`;
}

/* ================= Employee: New Pass ================= */
function renderNewPass() {
  const page = document.getElementById('page');
  page.innerHTML = `
    <div class="card" style="max-width:640px">
      <p class="card-title">Raise a gate pass</p>
      <div class="form-grid">
        <div class="field">
          <label>Pass Type</label>
          <select id="f-type" class="input">${options('PassType') || '<option>Official</option><option>Personal</option>'}</select>
        </div>
        <div class="field">
          <label>Planned Out</label>
          <input id="f-out" class="input" type="time" />
        </div>
        <div class="field">
          <label>Planned Return</label>
          <input id="f-in" class="input" type="time" />
        </div>
        <div class="field full">
          <label>Reason</label>
          <textarea id="f-reason" class="input" placeholder="Where and why are you going out?"></textarea>
        </div>
      </div>
      <button id="submitPass" class="btn btn-primary" style="margin-top:18px">Submit for Approval</button>
    </div>`;
  document.getElementById('submitPass').onclick = submitPass;
}

let submitting = false;
async function submitPass() {
  if (submitting) return;
  const rec = {
    PassType: document.getElementById('f-type').value,
    PlannedOut: document.getElementById('f-out').value,
    PlannedIn: document.getElementById('f-in').value,
    Reason: document.getElementById('f-reason').value.trim()
  };
  // client validation (mirrors server)
  if (!rec.PassType) return toast('Select a pass type', false);
  if (!rec.Reason) return toast('Reason is required', false);
  if (!rec.PlannedOut) return toast('Planned out time required', false);
  if (!rec.PlannedIn) return toast('Planned return time required', false);

  const btn = document.getElementById('submitPass');
  submitting = true; btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Submitting';
  try {
    const r = await api('createPass', { record: JSON.stringify(rec) });
    if (r.ok) { toast('Pass ' + r.passId + ' submitted'); go('mine'); }
    else toast(r.message || 'Failed', false);  // form data preserved on failure
  } catch (e) { toast(e.message + ' — data kept, retry', false); }
  finally { submitting = false; btn.disabled = false; btn.textContent = 'Submit for Approval'; }
}

/* ================= Employee: My Passes ================= */
async function renderMyPasses() {
  loading();
  try {
    const r = await api('listPasses', { page: 1 });
    if (!r.ok) return toast(r.message || 'Failed', false);
    if (!r.rows.length) return empty('No passes yet', 'Raise your first gate pass from “New Gate Pass”.');
    document.getElementById('page').innerHTML =
      '<div class="pass-list">' + r.rows.map(row => `
        <div class="pass-card">
          <div class="pass-main">
            <div class="pass-name">${esc(row.PassID)} · ${statusChip(row.Status)} ${delayChip(row)}</div>
            <div class="pass-meta">
              <b>${esc(row.PassType)}</b> — ${esc(row.Reason)}<br>
              Planned ${esc(row.PlannedOut)} → ${esc(row.PlannedIn)}
              ${row.ActualOut ? ' · Out ' + esc(row.ActualOut) : ''}${row.ActualIn ? ' · In ' + esc(row.ActualIn) : ''}
            </div>
          </div>
        </div>`).join('') + '</div>';
  } catch (e) { toast(e.message, false); }
}

/* ================= HOD: Approvals ================= */
async function renderApprovals() {
  loading();
  try {
    const r = await api('listPasses', { page: 1, status: 'Pending' });
    if (!r.ok) return toast(r.message || 'Failed', false);
    setBadge('approvals', r.rows.length);
    if (!r.rows.length) return empty('All clear', 'No passes waiting for approval.');
    document.getElementById('page').innerHTML =
      '<div class="pass-list">' + r.rows.map(row => `
        <div class="pass-card" data-id="${esc(row.PassID)}">
          <div class="pass-main">
            <div class="pass-name">${esc(row.EmployeeName)} <span class="muted">· ${esc(row.Department || '')}</span></div>
            <div class="pass-meta">
              <b>${esc(row.PassType)}</b> — ${esc(row.Reason)}<br>
              Planned ${esc(row.PlannedOut)} → ${esc(row.PlannedIn)} · ${esc(row.PassID)}
            </div>
          </div>
          <div class="pass-actions">
            <button class="btn btn-ok" data-act="approve">Approve</button>
            <button class="btn btn-bad" data-act="reject">Reject</button>
          </div>
        </div>`).join('') + '</div>';
    wirePassActions(renderApprovals);
  } catch (e) { toast(e.message, false); }
}

function wirePassActions(refresh) {
  document.querySelectorAll('.pass-card [data-act]').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.closest('.pass-card').dataset.id;
      const act = btn.dataset.act;
      const siblings = btn.closest('.pass-actions').querySelectorAll('button');
      siblings.forEach(b => b.disabled = true);
      btn.innerHTML = '<span class="spinner"></span>';
      try {
        const r = await api(act, { passId: id });
        if (r.ok) {
          toast(labelFor(act) + (r.delay !== undefined && r.delay > 0 ? ' · +' + r.delay + ' min late' : ''));
          refresh();
        } else { toast(r.message || 'Failed', false); siblings.forEach(b => b.disabled = false); btn.textContent = actLabel(act); }
      } catch (e) { toast(e.message, false); siblings.forEach(b => b.disabled = false); btn.textContent = actLabel(act); }
    };
  });
}
function labelFor(a){ return ({approve:'Approved',reject:'Rejected',markOut:'Marked out',markIn:'Marked in'})[a] || 'Done'; }
function actLabel(a){ return ({approve:'Approve',reject:'Reject',markOut:'Mark OUT',markIn:'Mark IN'})[a] || a; }

/* ================= Security: Gate Console ================= */
async function renderGate() {
  loading(3);
  try {
    const r = await api('listPasses', { page: 1 }); // Security scope = Approved + Out
    if (!r.ok) return toast(r.message || 'Failed', false);
    const ready = r.rows.filter(x => x.Status === 'Approved');
    const out   = r.rows.filter(x => x.Status === 'Out');
    document.getElementById('page').innerHTML = `
      <div>
        <div class="sec-head"><h3>Ready to go out</h3><span class="count-pill">${ready.length}</span></div>
        <div class="pass-list">${ready.length ? ready.map(row => gateCard(row, 'markOut', 'Mark OUT', 'btn-ok')).join('')
          : '<div class="empty"><div class="empty-emoji">✅</div>No approved passes waiting.</div>'}</div>
      </div>
      <div class="section-gap">
        <div class="sec-head"><h3>Currently out</h3><span class="count-pill">${out.length}</span></div>
        <div class="pass-list">${out.length ? out.map(row => gateCard(row, 'markIn', 'Mark IN', 'btn-primary', true)).join('')
          : '<div class="empty"><div class="empty-emoji">🏢</div>Nobody is out right now.</div>'}</div>
      </div>`;
    wirePassActions(renderGate);
    startTimers();
  } catch (e) { toast(e.message, false); }
}
function gateCard(row, act, label, cls, showTimer) {
  return `
    <div class="pass-card" data-id="${esc(row.PassID)}">
      <div class="pass-main">
        <div class="pass-name">${esc(row.EmployeeName)} <span class="muted">· ${esc(row.Department || '')}</span></div>
        <div class="pass-meta">
          <b>${esc(row.PassType)}</b> — ${esc(row.Reason)}<br>
          Planned ${esc(row.PlannedOut)} → ${esc(row.PlannedIn)}
          ${showTimer ? ` · out since <b>${esc(row.ActualOut)}</b> · <span class="timer" data-out="${esc(row.ActualOut)}" data-plan="${esc(row.PlannedIn)}">—</span>` : ''}
        </div>
      </div>
      <div class="pass-actions">
        <button class="btn ${cls} btn-lg" data-act="${act}">${label}</button>
      </div>
    </div>`;
}
function startTimers() {
  const tick = () => {
    const now = new Date(); const nowMin = now.getHours() * 60 + now.getMinutes();
    document.querySelectorAll('.timer').forEach(el => {
      const out = toMin(el.dataset.out), plan = toMin(el.dataset.plan);
      if (out === null) return;
      let mins = nowMin - out; if (mins < 0) mins += 1440;
      el.textContent = fmtDur(mins) + ' out';
      el.classList.toggle('over', plan !== null && nowMin > plan);
    });
  };
  tick(); timerInterval = setInterval(tick, 30000);
}
function toMin(hm){ const m = String(hm||'').match(/^(\d{1,2}):(\d{2})/); return m ? +m[1]*60 + +m[2] : null; }
function fmtDur(m){ const h = Math.floor(m/60), mm = m%60; return h ? h+'h '+mm+'m' : mm+'m'; }

/* ================= Dashboard ================= */
async function renderDashboard() {
  loading(4);
  try {
    const r = await api('dashboard', {});
    if (!r.ok) return toast(r.message || 'Failed', false);
    const s = r.stats;
    const late = r.topLate.length
      ? r.topLate.map(x => `<div class="pass-meta" style="padding:6px 0;border-bottom:1px solid var(--border)"><b>${esc(x.name)}</b> — ${x.delay} min</div>`).join('')
      : '<div class="muted" style="padding:8px 0">No late returns today.</div>';
    document.getElementById('page').innerHTML = `
      <div class="stat-grid">
        <div class="stat out"><div class="num">${s.currentlyOut}</div><div class="lbl">Currently Out</div></div>
        <div class="stat"><div class="num">${s.goneToday}</div><div class="lbl">Gone Today</div></div>
        <div class="stat ret"><div class="num">${s.returnedToday}</div><div class="lbl">Returned Today</div></div>
        <div class="stat late"><div class="num">${s.lateCount}</div><div class="lbl">Late Returns</div></div>
        <div class="stat warn"><div class="num">${s.totalDelay}</div><div class="lbl">Total Delay (min)</div></div>
      </div>
      <div class="card section-gap" style="max-width:520px">
        <p class="card-title">Official vs Personal (today)</p>
        <div class="pass-meta">Official: <b>${s.official}</b> · Personal: <b>${s.personal}</b></div>
      </div>
      <div class="card" style="max-width:520px">
        <p class="card-title">Top late returns (today)</p>
        ${late}
      </div>`;
  } catch (e) { toast(e.message, false); }
}

/* ================= Admin: All Passes ================= */
async function renderAllPasses() {
  const page = document.getElementById('page');
  page.innerHTML = `
    <div class="filter-row">
      <select id="fltStatus" class="input">
        <option value="">All statuses</option>
        <option>Pending</option><option>Approved</option><option>Out</option>
        <option>Returned</option><option>Rejected</option>
      </select>
      <label class="muted" style="display:flex;align-items:center;gap:6px">
        <input type="checkbox" id="fltToday"> Today only
      </label>
    </div>
    <div id="tblHost"></div>`;
  document.getElementById('fltStatus').onchange = e => { state.status = e.target.value; state.page = 1; loadTable(); };
  document.getElementById('fltToday').onchange = () => { state.page = 1; loadTable(); };
  loadTable();
}
async function loadTable() {
  const host = document.getElementById('tblHost');
  host.innerHTML = '<div class="skeleton"></div>'.repeat(4);
  const today = document.getElementById('fltToday') && document.getElementById('fltToday').checked;
  try {
    const r = await api('listPasses', { page: state.page, q: state.q, status: state.status, todayOnly: today ? 'true' : 'false' });
    if (!r.ok) return toast(r.message || 'Failed', false);
    state.lastRows = r.rows;
    if (!r.rows.length) { host.innerHTML = '<div class="empty"><div class="empty-emoji">🔍</div>No passes found.</div>'; return; }
    const cols = ['PassID','Date','EmployeeName','Department','PassType','PlannedOut','PlannedIn','ActualOut','ActualIn','DelayMinutes','Status'];
    const pages = Math.ceil(r.total / r.pageSize) || 1;
    host.innerHTML = `
      <div class="tbl-wrap">
        <table class="tbl">
          <thead><tr>${cols.map(c => `<th>${c.replace('Name','').replace('Minutes',' (min)')}</th>`).join('')}</tr></thead>
          <tbody>${r.rows.map(row => `<tr>${cols.map(c =>
            c === 'Status' ? `<td>${statusChip(row[c])}</td>` : `<td>${esc(row[c])}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
      </div>
      <div class="pager">
        <button class="btn btn-ghost" id="prev" ${r.page<=1?'disabled':''}>Prev</button>
        <span class="muted">Page ${r.page} / ${pages} · ${r.total} total</span>
        <button class="btn btn-ghost" id="next" ${r.page>=pages?'disabled':''}>Next</button>
      </div>`;
    const prev = document.getElementById('prev'), next = document.getElementById('next');
    if (prev) prev.onclick = () => { state.page--; loadTable(); };
    if (next) next.onclick = () => { state.page++; loadTable(); };
  } catch (e) { toast(e.message, false); }
}

/* ================= Admin: Employees ================= */
async function renderEmployees() {
  loading();
  try {
    const r = await api('listEmployees', {});
    if (!r.ok) return toast(r.message || 'Failed', false);
    document.getElementById('page').innerHTML = `
      <button class="btn btn-primary" style="width:auto;margin-bottom:16px" id="addEmp">+ Add Employee</button>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead><tr><th>ID</th><th>Name</th><th>Department</th><th></th></tr></thead>
          <tbody>${r.rows.length ? r.rows.map(e => `
            <tr><td><b>${esc(e.EmployeeID)}</b></td><td>${esc(e.Name)}</td><td>${esc(e.Department)}</td>
            <td><button class="btn btn-ghost editEmp"
              data-id="${esc(e.EmployeeID)}" data-name="${esc(e.Name)}" data-dept="${esc(e.Department)}">Edit</button></td></tr>`).join('')
            : '<tr><td colspan="4" class="empty">No employees yet.</td></tr>'}</tbody>
        </table>
      </div>`;
    document.getElementById('addEmp').onclick = () => employeeModal();
    document.querySelectorAll('.editEmp').forEach(b =>
      b.onclick = () => employeeModal({ EmployeeID: b.dataset.id, Name: b.dataset.name, Department: b.dataset.dept }));
  } catch (e) { toast(e.message, false); }
}
function employeeModal(emp) {
  const editing = !!emp;
  openModal(`${editing ? 'Edit' : 'Add'} Employee`, `
    <div class="field" style="margin-bottom:12px"><label>Employee ID</label>
      <input id="m-id" class="input" value="${esc(emp ? emp.EmployeeID : '')}" ${editing ? 'readonly' : ''} placeholder="EMP003"></div>
    <div class="field" style="margin-bottom:12px"><label>Name</label>
      <input id="m-name" class="input" value="${esc(emp ? emp.Name : '')}"></div>
    <div class="field"><label>Department</label>
      <select id="m-dept" class="input">${options('Department')}</select></div>`,
    async (close) => {
      const rec = { EmployeeID: val('m-id').trim(), Name: val('m-name').trim(), Department: val('m-dept'), Active: true };
      if (!rec.EmployeeID || !rec.Name) return toast('ID and Name required', false);
      const r = await api('saveEmployee', { record: JSON.stringify(rec) });
      if (r.ok) { toast('Saved'); close(); renderEmployees(); } else toast(r.message || 'Failed', false);
    });
  if (emp) document.getElementById('m-dept').value = emp.Department || '';
}

/* ================= Admin: Settings (config) ================= */
function renderSettings() {
  const rows = [];
  Object.keys(state.config).forEach(type =>
    state.config[type].forEach(o => rows.push({ type, value: o.value })));
  document.getElementById('page').innerHTML = `
    <div class="card" style="max-width:560px">
      <p class="card-title">Dropdown options (Pass Types & Departments)</p>
      <p class="muted" style="margin-top:-8px;margin-bottom:14px">Add or remove options used across the app. Saved back to the Config sheet.</p>
      <div id="cfgList">${rows.map((r, i) => cfgRow(r, i)).join('')}</div>
      <div class="filter-row" style="margin-top:14px">
        <select id="newType" class="input" style="max-width:150px"><option>PassType</option><option>Department</option></select>
        <input id="newVal" class="input" placeholder="New value" style="max-width:200px">
        <button class="btn btn-ghost" id="addCfg">+ Add</button>
      </div>
      <button class="btn btn-primary" style="width:auto;margin-top:8px" id="saveCfg">Save Settings</button>
    </div>`;
  const list = document.getElementById('cfgList');
  const draw = () => {
    list.innerHTML = rows.map((r, i) => cfgRow(r, i)).join('');
    list.querySelectorAll('.delCfg').forEach(b => b.onclick = () => { rows.splice(+b.dataset.i, 1); draw(); });
  };
  draw();
  document.getElementById('addCfg').onclick = () => {
    const v = val('newVal').trim(); if (!v) return;
    rows.push({ type: val('newType'), value: v }); document.getElementById('newVal').value = ''; draw();
  };
  document.getElementById('saveCfg').onclick = async () => {
    const items = rows.map(r => ({ type: r.type, key: r.value, value: r.value, active: true }));
    const r = await api('saveConfig', { items: JSON.stringify(items) });
    if (r.ok) { toast('Settings saved'); const c = await api('config'); if (c.ok) state.config = c.config; }
    else toast(r.message || 'Failed', false);
  };
}
function cfgRow(r, i) {
  return `<div class="pass-card" style="padding:10px 14px;animation:none">
    <div class="pass-main"><span class="chip chip-approved">${esc(r.type)}</span> &nbsp; <b>${esc(r.value)}</b></div>
    <button class="btn btn-ghost delCfg" data-i="${i}">Remove</button></div>`;
}

/* ================= Modal + small utils ================= */
function openModal(title, bodyHTML, onSave) {
  const host = document.getElementById('modalHost');
  host.innerHTML = `<div class="overlay"><div class="modal">
    <h3>${esc(title)}</h3>${bodyHTML}
    <div class="modal-actions">
      <button class="btn btn-ghost" id="mCancel">Cancel</button>
      <button class="btn btn-primary" id="mSave">Save</button>
    </div></div></div>`;
  const close = () => host.innerHTML = '';
  host.querySelector('.overlay').onclick = e => { if (e.target.classList.contains('overlay')) close(); };
  document.getElementById('mCancel').onclick = close;
  document.getElementById('mSave').onclick = async () => {
    const btn = document.getElementById('mSave'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    try { await onSave(close); } finally { if (document.getElementById('mSave')) { btn.disabled = false; btn.textContent = 'Save'; } }
  };
}
function val(id){ return document.getElementById(id).value; }
function empty(title, sub) {
  document.getElementById('page').innerHTML =
    `<div class="empty"><div class="empty-emoji">🗒️</div><b>${esc(title)}</b><div class="muted">${esc(sub)}</div></div>`;
}
function setBadge(view, n) {
  const b = document.querySelector(`[data-badge="${view}"]`);
  if (b) { b.textContent = n; b.classList.toggle('hidden', !n); }
}

/* ================= CSV export ================= */
function exportCSV() {
  const rows = state.lastRows || [];
  if (!rows.length) return toast('Nothing to export', false);
  const cols = ['PassID','Date','EmployeeID','EmployeeName','Department','PassType','Reason','PlannedOut','PlannedIn','ActualOut','ActualIn','DelayMinutes','TotalOutMinutes','Status','ApprovedBy'];
  const csv = [cols.join(',')].concat(rows.map(r =>
    cols.map(c => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(','))).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'GatePass_export.csv'; a.click();
}

/* ================= Wire up ================= */
document.querySelectorAll('.tab').forEach(t => t.onclick = () => switchTab(t.dataset.tab));
document.getElementById('empLoginBtn').onclick = empLogin;
document.getElementById('staffLoginBtn').onclick = staffLogin;
document.getElementById('empId').addEventListener('keydown', e => { if (e.key === 'Enter') empLogin(); });
document.getElementById('pin').addEventListener('keydown', e => { if (e.key === 'Enter') staffLogin(); });
document.getElementById('logoutBtn').onclick = () => location.reload();
document.getElementById('exportBtn').onclick = exportCSV;
let searchTimer;
document.getElementById('search').addEventListener('input', e => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.q = e.target.value; state.page = 1; loadTable(); }, 300);
});

/* ================= PWA ================= */
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
