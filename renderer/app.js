/* 待办 · 渲染进程 */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const CIRC_BIG = 2 * Math.PI * 23;
const CIRC_SM = 2 * Math.PI * 15;

const PRIO_LABEL = { 3: '高', 2: '中', 1: '低', 0: '无' };
const LIST_LABEL = { work: '工作', life: '生活', temp: '临时' };

let state = { tasks: [], settings: { theme: 'light', autostart: false, collapsed: false } };
let ui = {
  filter: 'all',
  pendingDue: null,
  pendingPrio: 0,
  showDone: false,
  showBacklog: false,
  editingId: null
};
let saveTimer = null;

/* ---------- 工具 ---------- */
const pad = n => String(n).padStart(2, '0');
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

function parseDue(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
}
const toDueString = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dueDateValue = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function fmtDue(s) {
  const d = parseDue(s);
  if (!d) return '';
  const now = new Date();
  const diff = Math.round((startOfDay(d) - startOfDay(now)) / 86400000);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (diff < 0) return `逾期 ${-diff} 天`;
  if (diff === 0) return `今天 ${hm}`;
  if (diff === 1) return `明天 ${hm}`;
  if (diff > 1 && diff < 7) return `周${'日一二三四五六'[d.getDay()]} ${hm}`;
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
  return `${String(d.getFullYear()).slice(2)}年${d.getMonth() + 1}月${d.getDate()}日`;
}

const isOverdue = t => {
  const d = parseDue(t.due);
  return !!d && !t.done && d.getTime() < Date.now();
};

/* ---------- 统计 ---------- */
function metrics() {
  const now = new Date();
  const dueToday = state.tasks.filter(t => t.due && sameDay(parseDue(t.due), now));
  const overdue = state.tasks.filter(t => t.due && !t.done && parseDue(t.due) < now && !sameDay(parseDue(t.due), now));
  const total = dueToday.length + overdue.length;
  const done = dueToday.filter(t => t.done).length;
  return { total, done, left: Math.max(0, total - done) };
}

/* ---------- 保存 ---------- */
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    window.api.save({ tasks: state.tasks, settings: { theme: state.settings.theme, autostart: state.settings.autostart } });
  }, 250);
}

/* ---------- 主题 ---------- */
function resolvedTheme() {
  if (state.settings.theme === 'dark') return 'dark';
  if (state.settings.theme === 'light') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function applyTheme() {
  document.documentElement.dataset.theme = resolvedTheme();
}
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (state.settings.theme === 'system') applyTheme();
});

/* ---------- 视图切换 ---------- */
function applyLayout() {
  const collapsed = !!state.settings.collapsed;
  $('#collapsed').hidden = !collapsed;
  $('#expanded').hidden = collapsed;
  if (collapsed) renderBar();
}

function setCollapsed(collapsed) {
  state.settings.collapsed = collapsed;
  applyLayout();
  window.api.collapse(collapsed);
  if (!collapsed) renderAll();
}

/* ---------- 渲染 ---------- */
function renderAll() {
  applyTheme();
  applyLayout();
  if (state.settings.collapsed) return;
  renderToday();
  renderFilters();
  renderList();
  renderFooter();
  renderSettings();
}

function renderToday() {
  const m = metrics();
  $('#today-count').textContent = `${m.done} / ${m.total}`;
  $('#today-sub').textContent =
    m.total === 0 ? '今天没有待办' : m.left === 0 ? '今天的都清了' : `还剩 ${m.left} 件`;
  const ratio = m.total ? m.done / m.total : 0;
  const ring = $('#ring');
  ring.setAttribute('stroke-dashoffset', String(CIRC_BIG * (1 - ratio)));
  ring.style.opacity = ratio > 0 ? '1' : '0';
}

function renderBar() {
  const m = metrics();
  $('#c-count').textContent = `${m.done}/${m.total}`;
  const ratio = m.total ? m.done / m.total : 0;
  const smallRing = $('#c-ring');
  smallRing.setAttribute('stroke-dashoffset', String(CIRC_SM * (1 - ratio)));
  smallRing.style.opacity = ratio > 0 ? '1' : '0';

  const next = state.tasks
    .filter(t => !t.done)
    .sort((a, b) => {
      const da = parseDue(a.due), db = parseDue(b.due);
      if (!da && !db) return b.priority - a.priority;
      if (!da) return 1;
      if (!db) return -1;
      return da - db;
    })[0];
  $('#c-next').textContent = next
    ? `${isOverdue(next) ? '逾期 · ' : ''}${next.title}`
    : (m.total === 0 ? '今天没有待办' : '今天的都清了');
}

function renderFilters() {
  $$('.fchip').forEach(b => b.classList.toggle('active', b.dataset.list === ui.filter));
}

function sortTasks(a, b) {
  const now = Date.now();
  const da = parseDue(a.due), db = parseDue(b.due);
  const rank = d => (!d ? 3 : d.getTime() < now ? 0 : sameDay(d, new Date()) ? 1 : 2);
  const ra = rank(da), rb = rank(db);
  if (ra !== rb) return ra - rb;
  if (da && db && da - db !== 0) return da - db;
  if (b.priority !== a.priority) return b.priority - a.priority;
  return (a.createdAt || '').localeCompare(b.createdAt || '');
}

function taskRow(t, options = {}) {
  const row = document.createElement('div');
  row.className = `task p${t.priority}` + (t.done ? ' done' : '');
  row.dataset.id = t.id;

  const check = document.createElement('button');
  check.className = 'check' + (t.done ? ' done' : '');
  check.title = t.done ? '撤销完成' : '标记完成';
  check.innerHTML = '<svg viewBox="0 0 24 24" width="9" height="9"><path d="M4 12.5l5 5 11-11"/></svg>';
  check.addEventListener('click', e => { e.stopPropagation(); toggleDone(t); });
  row.appendChild(check);

  const body = document.createElement('div');
  body.className = 'task-body';

  const title = document.createElement('span');
  title.className = 'task-title';
  title.textContent = t.title;
  body.appendChild(title);

  const meta = document.createElement('div');
  meta.className = 'task-meta';
  if (t.due) {
    const due = document.createElement('span');
    due.className = 'task-due' + (isOverdue(t) ? ' overdue' : '');
    due.textContent = fmtDue(t.due);
    meta.appendChild(due);
  }
  if (t.note && !t.done) {
    const note = document.createElement('span');
    note.className = 'task-note';
    note.textContent = t.note;
    meta.appendChild(note);
  }
  if (meta.childNodes.length) body.appendChild(meta);
  row.appendChild(body);

  const actions = document.createElement('div');
  actions.className = 'task-actions';
  const edit = document.createElement('button');
  edit.className = 'mini';
  edit.title = '编辑';
  edit.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" style="fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round"><path d="M4 20h4l10-10-4-4-10 10v4z"/></svg>';
  edit.addEventListener('click', e => { e.stopPropagation(); ui.editingId = t.id; renderList(); });
  actions.appendChild(edit);

  const del = document.createElement('button');
  del.className = 'mini';
  del.title = '删除';
  del.textContent = '×';
  del.addEventListener('click', e => { e.stopPropagation(); removeTask(t.id); });
  actions.appendChild(del);

  row.appendChild(actions);
  return row;
}

function editorRow(t, options = {}) {
  const box = document.createElement('div');
  box.className = 'editor';

  const title = document.createElement('input');
  title.type = 'text';
  title.value = t.title;
  box.appendChild(title);

  const note = document.createElement('textarea');
  note.rows = 2;
  note.placeholder = '备注（可留空）';
  note.value = t.note || '';
  box.appendChild(note);

  const when = document.createElement('div');
  when.className = 'btn-row';
  const date = document.createElement('input');
  date.type = 'date';
  date.style.flex = '1';
  const time = document.createElement('input');
  time.type = 'time';
  time.style.flex = '0 0 78px';
  const d = parseDue(t.due);
  if (d) { date.value = dueDateValue(d); time.value = `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
  const prio = document.createElement('select');
  prio.style.cssText = 'flex:0 0 62px;font-size:10.5px;padding:3px;border-radius:6px;border:1px solid var(--line);background:var(--card);color:var(--text)';
  [['3', '高'], ['2', '中'], ['1', '低'], ['0', '无']].forEach(([v, label]) => {
    const o = document.createElement('option');
    o.value = v; o.textContent = label; if (+v === t.priority) o.selected = true;
    prio.appendChild(o);
  });
  when.append(date, time, prio);
  box.appendChild(when);

  const act = document.createElement('div');
  act.className = 'editor-actions';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'ghost';
  saveBtn.textContent = '保存';
  const cancel = document.createElement('button');
  cancel.className = 'ghost';
  cancel.textContent = '取消';
  act.append(saveBtn, cancel);
  box.appendChild(act);

  saveBtn.addEventListener('click', () => {
    const v = title.value.trim();
    if (!v) { title.focus(); return; }
    // 归属清单可选
    t.title = v;
    t.note = note.value.trim();
    t.priority = +prio.value;
    t.due = date.value ? `${date.value} ${time.value || '18:00'}` : null;
    ui.editingId = null;
    save(); renderAll();
  });
  cancel.addEventListener('click', () => { ui.editingId = null; renderList(); });
  setTimeout(() => { title.focus(); title.select(); }, 30);

  return box;
}

function renderList() {
  const list = $('#list');
  list.innerHTML = '';

  const pool = state.tasks
    .filter(t => (ui.filter === 'all' ? true : t.list === ui.filter))
    .filter(t => !t.done && !!t.due)
    .sort(sortTasks);

  if (!pool.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = '今天没有待办<br>在上方输入框加一件';
    list.appendChild(empty);
  } else {
    pool.forEach(t => {
      list.appendChild(ui.editingId === t.id ? editorRow(t) : taskRow(t));
    });
  }

  // 待排期
  const backlog = state.tasks
    .filter(t => (ui.filter === 'all' ? true : t.list === ui.filter))
    .filter(t => !t.done && !t.due)
    .sort(sortTasks);

  if (ui.showBacklog && backlog.length) {
    const label = document.createElement('div');
    label.className = 'section-label';
    label.textContent = '待排期';
    list.appendChild(label);
    backlog.forEach(t => list.appendChild(ui.editingId === t.id ? editorRow(t) : taskRow(t)));
  }

  // 已完成
  const cutoff = Date.now() - 30 * 86400000;
  const done = state.tasks
    .filter(t => (ui.filter === 'all' ? true : t.list === ui.filter))
    .filter(t => t.done && (t.doneAt ? Date.parse(t.doneAt) > cutoff : false))
    .sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));

  if (ui.showDone && done.length) {
    const label = document.createElement('div');
    label.className = 'section-label';
    label.textContent = '已完成 · 30 天内';
    list.appendChild(label);
    done.forEach(t => list.appendChild(taskRow(t)));
  }
}

function renderFooter() {
  const inFilter = t => (ui.filter === 'all' ? true : t.list === ui.filter);
  const backlogCount = state.tasks.filter(t => inFilter(t) && !t.done && !t.due).length;
  const cutoff = Date.now() - 30 * 86400000;
  const doneCount = state.tasks.filter(t => inFilter(t) && t.done && (t.doneAt ? Date.parse(t.doneAt) > cutoff : false)).length;
  $('#backlog-count').textContent = backlogCount;
  $('#done-count').textContent = doneCount;
  $('#fold-backlog').classList.toggle('active', ui.showBacklog && backlogCount > 0);
  $('#fold-done').classList.toggle('active', ui.showDone && doneCount > 0);
}

function renderSettings() {
  $$('#theme-seg button').forEach(b => b.classList.toggle('active', b.dataset.theme === state.settings.theme));
  $('#sw-autostart').setAttribute('aria-pressed', String(!!state.settings.autostart));
  $('#data-path').textContent = '%APPDATA%\\DeskTodo\\tasks.json';
}

/* ---------- 操作 ---------- */
function toggleDone(t) {
  if (!t.done) {
    const row = $('#list').querySelector(`[data-id="${t.id}"]`);
    if (row) {
      row.classList.add('fade');
      setTimeout(() => {
        t.done = true;
        t.doneAt = new Date().toISOString();
        save(); renderAll(); renderFooter();
      }, 190);
    } else {
      t.done = true;
      t.doneAt = new Date().toISOString();
      save(); renderAll(); renderFooter();
    }
  } else {
    t.done = false;
    t.doneAt = null;
    save(); renderAll(); renderFooter();
  }
}

function removeTask(id) {
  state.tasks = state.tasks.filter(t => t.id !== id);
  if (ui.editingId === id) ui.editingId = null;
  save(); renderAll();
}

function addTask() {
  const input = $('#new-title');
  const title = input.value.trim();
  if (!title) { input.focus(); return; }
  state.tasks.push({
    id: uid(),
    title,
    note: '',
    list: ui.filter === 'all' ? 'temp' : ui.filter,
    priority: ui.pendingPrio,
    due: ui.pendingDue,
    done: false,
    doneAt: null,
    createdAt: new Date().toISOString()
  });
  input.value = '';
  ui.pendingDue = null;
  ui.pendingPrio = 0;
  syncChips();
  save(); renderAll();
  input.focus();
}

function syncChips() {
  const chipDue = $('#chip-due');
  const chipPrio = $('#chip-prio');
  if (ui.pendingDue) {
    chipDue.dataset.empty = '0';
    chipDue.textContent = `截止 ${fmtDue(ui.pendingDue)}`;
  } else {
    chipDue.dataset.empty = '1';
    chipDue.textContent = '截止';
  }
  if (ui.pendingPrio) {
    chipPrio.dataset.empty = '0';
    chipPrio.textContent = `优先级 ${PRIO_LABEL[ui.pendingPrio]}`;
  } else {
    chipPrio.dataset.empty = '1';
    chipPrio.textContent = '优先级';
  }
}

/* ---------- 浮层 ---------- */
function placePopover(pop, anchor) {
  pop.hidden = false;
  const r = anchor.getBoundingClientRect();
  const shell = document.querySelector('.panel').getBoundingClientRect();
  pop.style.left = `${Math.min(r.left - shell.left, shell.width - pop.offsetWidth - 8)}px`;
  pop.style.top = `${r.bottom - shell.top + 6}px`;
  pop.style.bottom = 'auto';
}
function closePopovers() {
  $('#due-pop').hidden = true;
  $('#prio-pop').hidden = true;
}

/* ---------- 事件绑定 ---------- */
function bind() {
  $('#btn-collapse').addEventListener('click', () => setCollapsed(true));
  $('#btn-expand').addEventListener('click', () => setCollapsed(false));
  $('#btn-settings').addEventListener('click', () => { $('#settings').hidden = false; });
  $('#btn-close-settings').addEventListener('click', () => { $('#settings').hidden = true; });

  $('#new-title').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addTask(); }
  });

  $('#chip-due').addEventListener('click', e => {
    e.stopPropagation();
    const pop = $('#due-pop');
    if (pop.hidden) {
      closePopovers();
      const d = new Date();
      $('#due-date').value = dueDateValue(d);
      $('#due-time').value = '18:00';
      placePopover(pop, e.currentTarget);
    } else pop.hidden = true;
  });

  $$('#due-pop [data-quick]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    const d = new Date();
    if (b.dataset.quick === 'clear') ui.pendingDue = null;
    else {
      if (b.dataset.quick === 'tomorrow') d.setDate(d.getDate() + 1);
      d.setHours(18, 0, 0, 0);
      ui.pendingDue = toDueString(d);
    }
    syncChips();
    $('#due-pop').hidden = true;
  }));

  $('#due-apply').addEventListener('click', e => {
    e.stopPropagation();
    const dv = $('#due-date').value;
    if (!dv) return;
    ui.pendingDue = `${dv} ${$('#due-time').value || '18:00'}`;
    syncChips();
    $('#due-pop').hidden = true;
  });

  $('#chip-prio').addEventListener('click', e => {
    e.stopPropagation();
    const pop = $('#prio-pop');
    if (pop.hidden) { closePopovers(); placePopover(pop, e.currentTarget); }
    else pop.hidden = true;
  });

  $$('#prio-pop [data-prio]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    ui.pendingPrio = +b.dataset.prio;
    syncChips();
    $('#prio-pop').hidden = true;
  }));

  $('#filters').addEventListener('click', e => {
    const b = e.target.closest('.fchip');
    if (!b) return;
    ui.filter = b.dataset.list;
    ui.showDone = false; ui.showBacklog = false;
    renderAll(); renderFooter();
  });

  $('#fold-done').addEventListener('click', () => {
    ui.showDone = !ui.showDone;
    renderList(); renderFooter();
  });
  $('#fold-backlog').addEventListener('click', () => {
    ui.showBacklog = !ui.showBacklog;
    renderList(); renderFooter();
  });

  $$('#theme-seg button').forEach(b => b.addEventListener('click', () => {
    state.settings.theme = b.dataset.theme;
    applyTheme(); renderSettings(); save();
  }));

  $('#sw-autostart').addEventListener('click', () => {
    state.settings.autostart = !state.settings.autostart;
    save();
    renderSettings();
  });

  $('#btn-export').addEventListener('click', async () => {
    const res = await window.api.exportJSON();
    const btn = $('#btn-export');
    btn.textContent = res.ok ? '已导出' : '已取消';
    setTimeout(() => { btn.textContent = '导出 JSON'; }, 1200);
  });
  $('#btn-import').addEventListener('click', async () => {
    const res = await window.api.importJSON();
    const btn = $('#btn-import');
    btn.textContent = res.ok ? `已导入 ${res.count} 条` : '导入失败';
    setTimeout(() => { btn.textContent = '导入 JSON'; }, 1600);
  });
  $('#btn-reveal').addEventListener('click', () => window.api.revealData());

  document.addEventListener('mousedown', e => {
    if (!e.target.closest('.popover') && !e.target.closest('.chip')) closePopovers();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const settingsOpen = !$('#settings').hidden;
      const popOpen = !$('#due-pop').hidden || !$('#prio-pop').hidden;
      if (settingsOpen) { $('#settings').hidden = true; return; }
      if (popOpen) { closePopovers(); return; }
      if (ui.editingId) { ui.editingId = null; renderList(); return; }
      window.api.hide();
    }
  });

  window.addEventListener('beforeunload', () => { /* 数据已实时落盘 */ });
}

/* ---------- 启动 ---------- */
async function boot() {
  const data = await window.api.load();
  state.tasks = (data.tasks || []).map(t => ({
    priority: 0, note: '', list: 'temp', done: false, doneAt: null, due: null, createdAt: '', ...t
  }));
  state.settings = { ...state.settings, ...(data.settings || {}) };
  applyTheme();
  syncChips();
  bind();
  renderAll();
  renderFooter();
  renderBar();
  setInterval(() => { if (!state.settings.collapsed) renderToday(); renderBar(); }, 60000);
  window.api.onReload(d => {
    state.tasks = (d.tasks || []).map(t => ({ priority: 0, note: '', list: 'temp', done: false, doneAt: null, due: null, createdAt: '', ...t }));
    renderAll(); renderFooter();
  });
}

boot();
