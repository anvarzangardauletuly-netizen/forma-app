/* ============================================================
   FORMA — ядро: утилиты, иконки, хранилище, состояние, UI-примитивы
   ============================================================ */
'use strict';

/* ---------- Утилиты ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const r0 = (n) => Math.round(+n || 0);
const r1 = (n) => Math.round((+n || 0) * 10) / 10;
const fmt = (n, d = 0) => (+n || 0).toLocaleString('ru-RU', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.').trim()); return Number.isFinite(n) ? n : NaN; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, msg = 'timeout') => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej({ code: 'timeout', message: msg }), ms))]);
const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[«»"(),.%]/g, ' ').replace(/\s+/g, ' ').trim();

/* Даты: всегда локальная дата в формате YYYY-MM-DD */
function isoOf(d) { const z = new Date(d); return `${z.getFullYear()}-${String(z.getMonth() + 1).padStart(2, '0')}-${String(z.getDate()).padStart(2, '0')}`; }
const todayISO = () => isoOf(new Date());
function parseISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(iso, n) { const d = parseISO(iso); d.setDate(d.getDate() + n); return isoOf(d); }
function diffDays(a, b) { return Math.round((parseISO(b) - parseISO(a)) / 86400000); }
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_N = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const WD = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const WD_FULL = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
function fmtDate(iso, opts = {}) {
  const d = parseISO(iso); const t = todayISO();
  if (!opts.full) { if (iso === t) return 'Сегодня'; if (iso === addDays(t, -1)) return 'Вчера'; if (iso === addDays(t, 1)) return 'Завтра'; }
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : ''}`;
}
const fmtShort = (iso) => { const d = parseISO(iso); return `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')}`; };
function weekStart(iso) { const d = parseISO(iso); const wd = (d.getDay() + 6) % 7; return addDays(iso, -wd); }
function rangeDays(from, to) { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; }

/* ---------- Иконки (stroke-SVG) ---------- */
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  book: '<path d="M4 19.5V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2.5Z"/><path d="M8 7h7M8 11h5"/>',
  db: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M7 8v8M10 8v8M13 8v8M17 8v8"/>',
  calc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01"/>',
  scale: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M8 9a5.5 5.5 0 0 1 8 0l-2.5 3h-3Z"/>',
  dumbbell: '<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="M13.5 6.5l4 4"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9Z"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  drop: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z"/>',
  steps: '<path d="M8 3c-1.7 0-3 2-3 4.5S6 12 6 13h4c0-1 1-3 1-5.5S9.7 3 8 3Z"/><path d="M6 16h4v1.5a2 2 0 0 1-4 0Z"/><path d="M16 7c-1.7 0-3 2-3 4.5s1 4.5 1 5.5h4c0-1 1-3 1-5.5S17.7 7 16 7Z"/><path d="M14 20h4"/>',
  flame: '<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5.3 1.5 1 2.5 2 2.5 0-3 0-5.5 1-8Z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4Z"/><circle cx="12" cy="13" r="3.5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-8 9"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>',
  sunrise: '<path d="M12 3v5M5.6 9.6l1.4 1.4M18.4 9.6 17 11M3 17h18M7 17a5 5 0 0 1 10 0M8 21h8"/>',
  apple: '<path d="M12 7c-1.5-1-5-1.5-6.5 1.5S5 16 7.5 19c1.3 1.6 2.7 1.5 4.5.7 1.8.8 3.2.9 4.5-.7C19 16 20 11.5 18.5 8.5S13.5 6 12 7Z"/><path d="M12 7c0-2 1-3.5 3-4"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
  cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.7 12.4a1 1 0 0 0 1 .8h9.7a1 1 0 0 0 1-.8L21 7H6"/>',
  play: '<path d="M7 4v16l13-8Z"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/>',
  grid: '<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/>',
  bell: '<path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 8 2.5 8h-17S6 15 6 9Z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  dn: '<path d="M12 5v14M5 12l7 7 7-7"/>',
  heart: '<path d="M12 20s-7.5-4.5-7.5-10A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 7.5 3c0 5.5-7.5 10-7.5 10Z"/>',
  send: '<path d="M4 12 20 4l-6 16-3-7Z"/><path d="m11 13 9-9"/>',
  logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  fork: '<path d="M7 3v8a2 2 0 0 0 2 2v8M5 3v5a2 2 0 0 0 2 2M9 3v5a2 2 0 0 1-2 2M17 21V3c-2 1-3 4-3 7s1 4 3 4"/>',
};
function ic(name, size = 20, extra = '') {
  return `<svg class="ic ${extra}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

/* ============================================================
   ХРАНИЛИЩЕ
   Облако: возможность `db` платформы Claude, личное пространство
   data/users/<id>/ (данные пользователя недоступны никому другому, включая владельца).
   Резерв: localStorage в этом браузере (если облако недоступно / нет прав на запись).
   Каждый документ — один «ключ»: profile, meta, weights, programs, exlib, plan, active,
   day-YYYY-MM-DD, food-<id>, recipe-<id>, wo-<id>
   ============================================================ */
const LS = 'forma:v1:';
const Store = {
  mode: 'local', db: null, col: null, uid: null, user: null, me: null, cloudNote: '',
  timers: {}, pending: {}, chains: {}, saving: 0,

  async init() {
    const hasClaude = window.self !== window.top && await waitFor(() => window.claude && typeof window.claude.use === 'function', 2500);
    if (hasClaude) {
      try {
        const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
        this.user = user;
        if (db && user) {
          const id = await user.id();
          if (id) {
            this.db = db; this.uid = id; this.col = db.collection('data/users/' + id); this.mode = 'cloud';
            try { this.me = await user.me(); } catch (e) { /* имя не обязательно */ }
          }
        }
        if (this.mode !== 'cloud') this.cloudNote = 'Войдите в аккаунт Claude, чтобы данные синхронизировались между устройствами.';
      } catch (e) { console.warn('db init', e); }
    } else if (typeof Supa !== 'undefined' && Supa.enabled && !Supa.skipped()) {
      // Свой сайт (Vercel): вход и облако через Supabase — см. account.js
      if (!(await supaInit())) this.needAuth = true;
    }
    return this.loadAll();
  },

  async loadAll() {
    if (this.backend === 'supa') return supaLoad();
    if (this.mode === 'cloud') {
      try {
        const snap = await withTimeout(this.col.get(), 15000, 'Облако не отвечает');
        const out = {};
        snap.docs.forEach((d) => { if (d.exists) out[d.id] = clone(d.data()); });
        this.migrated = this.mergeLocal(out);
        return out;
      } catch (e) {
        console.warn('cloud load failed', e);
        this.mode = 'local';
        this.cloudNote = 'Облачное хранилище не отвечает — данные сохраняются в этом браузере.';
      }
    }
    const out = {};
    try {
      const idx = JSON.parse(localStorage.getItem(LS + 'index') || '[]');
      idx.forEach((k) => { const v = localStorage.getItem(LS + k); if (v) out[k] = JSON.parse(v); });
    } catch (e) { this.cloudNote = 'Хранилище браузера недоступно — данные не сохранятся после закрытия.'; }
    return out;
  },

  save(key, value) {
    this.pending[key] = { value: clone(value) };
    clearTimeout(this.timers[key]);
    this.timers[key] = setTimeout(() => this.flush(key), 500);
    syncState();
  },
  remove(key) {
    this.pending[key] = { del: true };
    clearTimeout(this.timers[key]);
    this.timers[key] = setTimeout(() => this.flush(key), 100);
    syncState();
  },
  flushAll() { Object.keys(this.pending).forEach((k) => { clearTimeout(this.timers[k]); this.flush(k); }); },

  flush(key) {
    const job = this.pending[key]; if (!job) return; delete this.pending[key];
    if (this.backend === 'supa') { supaFlush(key, job); return; }
    if (this.mode !== 'cloud') { this.writeLocal(key, job); syncState(); return; }
    this.saving++; syncState();
    const run = async () => {
      const ref = this.col.doc(key);
      const op = () => (job.del ? ref.delete() : ref.set(job.value));
      try { await op(); }
      catch (e) {
        if (e && e.code === 'unavailable') { await sleep(800 + Math.random() * 1200); await op(); }
        else throw e;
      }
    };
    this.chains[key] = (this.chains[key] || Promise.resolve()).then(run).catch((e) => this.onError(e, key, job))
      .finally(() => { this.saving--; syncState(); });
  },

  writeLocal(key, job) {
    try {
      const idx = new Set(JSON.parse(localStorage.getItem(LS + 'index') || '[]'));
      if (job.del) { localStorage.removeItem(LS + key); idx.delete(key); }
      else { localStorage.setItem(LS + key, JSON.stringify(job.value)); idx.add(key); }
      localStorage.setItem(LS + 'dirtyAt', String(Date.now()));
      localStorage.setItem(LS + 'index', JSON.stringify([...idx]));
    } catch (e) { toast('Не удалось сохранить в браузере: память переполнена или запрещена', 'err'); }
  },

  /* Данные, записанные в этом браузере без облака (например, открыто до входа в аккаунт),
     автоматически переносятся в облако — так история появляется на всех устройствах. */
  mergeLocal(cloud) {
    let idx = [];
    try { idx = JSON.parse(localStorage.getItem(LS + 'index') || '[]'); } catch (e) { return []; }
    const dirty = +localStorage.getItem(LS + 'dirtyAt') || (idx.length ? 1 : 0);
    const done = +localStorage.getItem(LS + 'migratedAt') || 0;
    if (!idx.length || dirty <= done) return [];
    const changed = [];
    idx.forEach((k) => {
      let v; try { v = JSON.parse(localStorage.getItem(LS + k)); } catch (e) { return; }
      if (!v) return;
      const c = cloud[k];
      if (!c) { cloud[k] = v; changed.push(k); return; }
      const m = mergeDoc(k, clone(c), v);
      if (m && JSON.stringify(m) !== JSON.stringify(c)) { cloud[k] = m; changed.push(k); }
    });
    this.pendingMigration = true;
    return changed;
  },
  markMigrated() { try { localStorage.setItem(LS + 'migratedAt', String(Date.now())); } catch (e) { /* нет хранилища */ } this.pendingMigration = false; },

  onError(e, key, job) {
    console.warn('save error', key, e);
    const code = e && e.code;
    if (code === 'invalid_argument' || code === 'not_granted' || code === 'revoked' || code === 'capability_disabled') {
      // Нет прав на запись в облако → переходим на хранение в браузере, ничего не теряем
      this.mode = 'local';
      this.cloudNote = 'Нет доступа к облачному сохранению — данные хранятся в этом браузере.';
      const all = docsFromState(); Object.keys(all).forEach((k) => this.writeLocal(k, { value: all[k] }));
      toast('Облако недоступно для записи. Данные сохранены в этом браузере.', 'warn');
      renderChrome();
    } else if (code === 'quota_exceeded') {
      toast('Хранилище заполнено: удалите старые записи или экспортируйте данные.', 'err');
    } else if (code === 'resource_exhausted') {
      toast('Слишком много изменений подряд — повторяю сохранение…', 'warn');
      setTimeout(() => { if (!this.pending[key]) { this.pending[key] = job; this.flush(key); } }, 4000);
    } else {
      toast('Не удалось сохранить изменения. Проверьте соединение.', 'err');
      setTimeout(() => { if (!this.pending[key]) { this.pending[key] = job; this.flush(key); } }, 6000);
    }
  },
};
function waitFor(fn, ms) {
  return new Promise((res) => {
    if (fn()) return res(true);
    const t0 = Date.now(); const iv = setInterval(() => { if (fn()) { clearInterval(iv); res(true); } else if (Date.now() - t0 > ms) { clearInterval(iv); res(false); } }, 50);
  });
}
function unionBy(a, b, key) { const seen = new Set((a || []).map((x) => x[key])); return [...(a || []), ...(b || []).filter((x) => !seen.has(x[key]))]; }
function mergeDoc(k, c, l) {
  if (k.startsWith('day-')) {
    const d = normDay(c, k.slice(4)); const L = normDay(l, k.slice(4));
    Object.keys(L.meals).forEach((m) => { d.meals[m] = unionBy(d.meals[m], L.meals[m], 'id'); });
    d.water = Math.max(d.water || 0, L.water || 0);
    if (d.steps == null && L.steps != null) { d.steps = L.steps; d.stepsSrc = L.stepsSrc; } else if (L.steps != null) d.steps = Math.max(d.steps, L.steps);
    d.activities = unionBy(d.activities, L.activities, 'id'); d.runs = unionBy(d.runs, L.runs, 'id'); if ((L.stepsRun || 0) > (d.stepsRun || 0)) { d.stepsRun = L.stepsRun; d.kmRun = L.kmRun; } d.note = d.note || L.note || '';
    return d;
  }
  if (k === 'weights') { c.entries = unionBy(c.entries, l.entries, 'date').sort((a, b) => (a.date < b.date ? -1 : 1)); return c; }
  if (k === 'programs' || k === 'exlib') { c.list = unionBy(c.list, l.list, 'id'); return c; }
  if (k === 'meta') { c.favorites = [...new Set([...(c.favorites || []), ...(l.favorites || [])])]; c.recent = [...new Set([...(c.recent || []), ...(l.recent || [])])].slice(0, 40); return c; }
  if (k === 'plan') { c.days = Object.assign({}, l.days || {}, c.days || {}); c.shop = Object.assign({}, l.shop || {}, c.shop || {}); return c; }
  if (k === 'active') return c;
  return null; // profile, продукты, рецепты, тренировки с тем же id — облачная версия главнее
}
function syncState() {
  const busy = Store.saving > 0 || Object.keys(Store.pending).length > 0;
  const off = Store.mode === 'cloud' && Store.offline;
  const top = $('#syncTop'); if (top) { top.className = 'sync ' + (busy ? 'busy' : 'ok') + (Store.mode === 'cloud' && !off ? '' : ' local'); top.title = off ? 'Нет связи — изменения на устройстве, отправятся позже' : Store.mode === 'cloud' ? 'Синхронизировано с облаком' : 'Данные только в этом браузере'; top.innerHTML = `<i></i>${off ? 'Офлайн' : Store.mode === 'cloud' ? 'Облако' : 'Локально'}`; }
  const el = $('#sync'); if (!el) return;
  el.className = 'sync ' + (busy ? 'busy' : 'ok') + (off ? ' local' : '');
  el.title = off ? 'Нет связи — изменения отправятся позже' : Store.mode === 'cloud' ? (busy ? 'Сохранение…' : 'Сохранено в облаке') : (busy ? 'Сохранение…' : 'Сохранено в браузере');
  el.innerHTML = `<i></i>${busy ? 'Сохранение…' : off ? 'Офлайн' : (Store.mode === 'cloud' ? 'В облаке' : 'Локально')}`;
}
window.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') Store.flushAll(); });
window.addEventListener('pagehide', () => Store.flushAll());

/* ============================================================
   СОСТОЯНИЕ
   ============================================================ */
const D = {
  profile: null, meta: { favorites: [], recent: [] }, weights: { entries: [] }, programs: { list: [] },
  exlib: { list: [] }, plan: { days: {}, shop: {} }, active: null,
  days: {}, foods: {}, recipes: {}, workouts: {},
};
function hydrate(docs) {
  Object.entries(docs).forEach(([k, v]) => {
    if (k === 'profile') D.profile = v;
    else if (k === 'meta') D.meta = Object.assign({ favorites: [], recent: [] }, v);
    else if (k === 'weights') D.weights = Object.assign({ entries: [] }, v);
    else if (k === 'programs') D.programs = Object.assign({ list: [] }, v);
    else if (k === 'exlib') D.exlib = Object.assign({ list: [] }, v);
    else if (k === 'plan') D.plan = Object.assign({ days: {}, shop: {} }, v);
    else if (k === 'active') D.active = v && v.exercises ? v : null;
    else if (k.startsWith('day-')) D.days[k.slice(4)] = normDay(v, k.slice(4));
    else if (k.startsWith('food-')) D.foods[k.slice(5)] = v;
    else if (k.startsWith('recipe-')) D.recipes[k.slice(7)] = v;
    else if (k.startsWith('wo-')) D.workouts[k.slice(3)] = v;
  });
}
function docsFromState() {
  const o = {};
  if (D.profile) o.profile = D.profile;
  o.meta = D.meta; o.weights = D.weights; o.programs = D.programs; o.exlib = D.exlib; o.plan = D.plan;
  if (D.active) o.active = D.active;
  Object.entries(D.days).forEach(([k, v]) => { o['day-' + k] = v; });
  Object.entries(D.foods).forEach(([k, v]) => { o['food-' + k] = v; });
  Object.entries(D.recipes).forEach(([k, v]) => { o['recipe-' + k] = v; });
  Object.entries(D.workouts).forEach(([k, v]) => { o['wo-' + k] = v; });
  return o;
}
function persist(key) {
  let v;
  if (key.startsWith('day-')) v = D.days[key.slice(4)];
  else if (key.startsWith('food-')) v = D.foods[key.slice(5)];
  else if (key.startsWith('recipe-')) v = D.recipes[key.slice(7)];
  else if (key.startsWith('wo-')) v = D.workouts[key.slice(3)];
  else v = D[key];
  if (v == null) Store.remove(key); else Store.save(key, v);
}

/* ---------- Питание: расчёты ---------- */
const NK = ['kcal', 'p', 'f', 'c', 'fib', 'sug', 'salt'];
const zeroN = () => ({ kcal: 0, p: 0, f: 0, c: 0, fib: 0, sug: 0, salt: 0 });
function scaleN(per, g) { const o = zeroN(); NK.forEach((k) => { o[k] = ((per && per[k]) || 0) * g / 100; }); return o; }
function addN(a, b) { NK.forEach((k) => { a[k] += b[k] || 0; }); return a; }

function emptyDay(date) { return { kind: 'day', date, meals: { breakfast: [], lunch: [], dinner: [], snack: [] }, water: 0, steps: null, stepsSrc: null, activities: [], note: '' }; }
function normDay(v, date) { const d = Object.assign(emptyDay(date), v || {}); d.meals = Object.assign({ breakfast: [], lunch: [], dinner: [], snack: [] }, d.meals || {}); d.activities = d.activities || []; return d; }
function getDay(date) { return D.days[date] || emptyDay(date); }
function ensureDay(date) { if (!D.days[date]) D.days[date] = emptyDay(date); return D.days[date]; }
function saveDay(date) { const d = D.days[date]; if (!d) return; persist('day-' + date); }
function itemN(it) { return scaleN(it.per, it.g); }
function mealTotals(day, meal) { return (day.meals[meal] || []).reduce((acc, it) => addN(acc, itemN(it)), zeroN()); }
function dayTotals(day) { const t = zeroN(); MEALS.forEach((m) => addN(t, mealTotals(day, m.id))); return t; }
function dayHasFood(day) { return MEALS.some((m) => (day.meals[m.id] || []).length); }

function curWeight() {
  const e = D.weights.entries; if (e.length) return [...e].sort((a, b) => (a.date < b.date ? 1 : -1))[0].kg;
  return (D.profile && D.profile.weight) || 70;
}
function curHeight() {
  const h = (D.profile && D.profile.heights) || []; if (h.length) return [...h].sort((a, b) => (a.date < b.date ? 1 : -1))[0].cm;
  return (D.profile && D.profile.height) || 170;
}
function targets() {
  const t = (D.profile && D.profile.targets) || {};
  return { kcal: t.kcal || 2000, p: t.p || 100, f: t.f || 65, c: t.c || 250, fib: t.fib || 28, water: t.water || 2000, steps: (D.profile && D.profile.stepsGoal) || 8000 };
}
/* ---------- Шаги и расход ----------
   Шаги делятся на ходьбу и бег (бег определяет шагомер по темпу и силе толчка).
   В норму калорий добавляется только то, что сверх обычного дня (первые STEPS_BASE шагов ходьбы
   уже заложены в коэффициент активности), а бег — целиком. */
const STEPS_BASE = 5000;
function strideM(kind) { return curHeight() * (kind === 'run' ? 0.65 : 0.415) / 100; }
function dayStepParts(day) {
  const total = Math.max(0, day.steps || 0); const run = Math.min(total, day.stepsRun || 0); const walk = total - run;
  const kmRun = run ? (day.kmRun != null ? day.kmRun : run * strideM('run') / 1000) : 0;
  const kmWalk = walk * strideM('walk') / 1000;
  return { total, run, walk, kmRun, kmWalk, km: kmRun + kmWalk };
}
function stepsBurn(day) {
  const s = dayStepParts(day); const w = curWeight();
  const walkK = 0.5 * w * s.kmWalk; const runK = 1.0 * w * s.kmRun;
  const baseK = 0.5 * w * Math.min(s.walk, STEPS_BASE) * strideM('walk') / 1000;
  return { total: walkK + runK, walk: walkK, run: runK, extra: Math.max(0, walkK - baseK) + runK };
}
function stepsKcal(steps) { return stepsBurn({ steps }).total; }
function workoutsOn(date) { return Object.values(D.workouts).filter((w) => w.date === date); }
function workoutKcal(w) { return 5 * (w.weightKg || curWeight()) * (w.durationMin || 0) / 60; }
function dayBurned(date) {
  const day = getDay(date);
  const act = (day.activities || []).reduce((s, a) => s + (a.kcal || 0), 0);
  const wo = workoutsOn(date).reduce((s, w) => s + workoutKcal(w), 0);
  const sb = stepsBurn(day);
  return { act, wo, steps: sb.total, stepsExtra: sb.extra, total: act + wo + sb.total };
}
function dayBudget(date) {
  const t = targets(); const S = (D.profile && D.profile.settings) || {};
  const b = dayBurned(date);
  return t.kcal + (S.stepsInBudget !== false ? Math.round(b.stepsExtra) : 0) + (S.addBurned ? Math.round(b.act + b.wo) : 0);
}

/* ---------- Каталог продуктов ---------- */
function recipeTotals(r) {
  const t = zeroN(); let g = 0;
  (r.ingredients || []).forEach((i) => { addN(t, scaleN(i.per, i.g)); g += +i.g || 0; });
  return { n: t, grams: g };
}
function recipeAsFood(r) {
  const { n, grams } = recipeTotals(r);
  const per = zeroN(); if (grams > 0) NK.forEach((k) => { per[k] = n[k] / grams * 100; });
  const sv = Math.max(1, +r.servings || 1);
  return { id: 'r_' + r.id, name: r.name, brand: 'Моё блюдо', cat: 'recipe', per, portion: { g: Math.round(grams / sv) || 100, label: '1 порция' }, recipe: true, rid: r.id };
}
function customAsFood(f) { return Object.assign({}, f, { id: 'c_' + f.id, cid: f.id, custom: true, cat: f.cat || 'custom' }); }
let _foodsCache = null;
function invalidateFoods() { _foodsCache = null; }
function allFoods() {
  if (_foodsCache) return _foodsCache;
  _foodsCache = [
    ...Object.values(D.foods).map(customAsFood),
    ...Object.values(D.recipes).map(recipeAsFood),
    ...BASE_FOODS,
  ];
  return _foodsCache;
}
function findFood(id) {
  if (!id) return null;
  if (id.startsWith('c_')) { const f = D.foods[id.slice(2)]; return f ? customAsFood(f) : null; }
  if (id.startsWith('r_')) { const r = D.recipes[id.slice(2)]; return r ? recipeAsFood(r) : null; }
  return BASE_FOODS.find((f) => f.id === id) || null;
}
/* Поиск понимает разные формы слов («жареные яйца» → «Яйцо жареное», «яичница») и разговорные синонимы */
const FOOD_ALIASES = [
  [/^(яйц|яичниц|омлет)|глазунь|болтунь/, 'яйца яйцо яичница жареные глазунья'],
  [/картоф|пюре|фри|драник/, 'картошка картофель'],
  [/макарон|спагетти|лапша|паста/, 'макароны паста'],
  [/кур(ин|иц)|цыпл|наггетс/, 'курица куриное'],
  [/говяд|телят|бефстроганов|гуляш|азу/, 'говядина мясо'],
  [/свин|бекон|сало|карбонад/, 'свинина мясо'],
  [/кока-кола|coca-cola/, 'кока кола cola coca'],
  [/пепси|pepsi/, 'пепси pepsi'],
  [/шаурм|донер|гирос/, 'шаурма шаверма донер'],
  [/сосиск|сардельк/, 'сосиска сосиски'],
  [/гречк|гречн/, 'гречка гречневая'],
  [/творог|творож/, 'творог творожный'],
  [/плов/, 'плов'], [/бургер|чизбургер|гамбургер|воппер|мак/, 'бургер'],
];
function stemRu(w) { return w.length >= 4 ? w.slice(0, Math.max(3, w.length - 3)) : w; }
/* основа слова должна стоять в начале какого-то слова: «сник(ерс)» не должно находить «бру-сник-а» */
const hasStem = (hay, w) => (' ' + hay).includes(' ' + stemRu(w));
function foodHay(f) {
  if (f._hay) return f._hay;
  const name = norm(f.name); let hay = name + ' ' + norm(f.brand || '') + ' ' + norm(FOOD_CATS[f.cat] || '');
  FOOD_ALIASES.forEach(([re, extra]) => { if (re.test(name)) hay += ' ' + extra; });
  try { Object.defineProperty(f, '_hay', { value: hay, enumerable: false, configurable: true }); } catch (e) { /* замороженный объект */ }
  return hay;
}
function searchFoods(q, limit = 60) {
  const nq = norm(q); const list = allFoods();
  if (!nq) return list.slice(0, limit);
  if (/^\d{6,14}$/.test(nq)) return list.filter((f) => f.barcode === nq);
  const words = nq.split(' ');
  const scored = [];
  for (const f of list) {
    const hay = foodHay(f); let exact = 0; let ok = true;
    for (const w of words) { if (hay.includes(w)) exact++; else if (!hasStem(hay, w)) { ok = false; break; } }
    if (!ok) continue;
    const nn = norm(f.name);
    let s = exact * 3; if (nn.startsWith(nq)) s += 10; if (words.some((w) => nn.startsWith(w) || nn.startsWith(stemRu(w)))) s += 5; if (f.custom || f.recipe) s += 3;
    if (words.every((w) => nn.includes(w) || hasStem(nn, w))) s += 4; // все слова — в самом названии
    if (D.meta.favorites.includes(f.id)) s += 2; s -= nn.length / 100;
    scored.push([s, f]);
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, limit).map((x) => x[1]);
}
function pushRecent(id) {
  const r = D.meta.recent.filter((x) => x !== id); r.unshift(id); D.meta.recent = r.slice(0, 40); persist('meta');
}
function isFav(id) { return D.meta.favorites.includes(id); }
function toggleFav(id) {
  if (isFav(id)) D.meta.favorites = D.meta.favorites.filter((x) => x !== id); else D.meta.favorites.unshift(id);
  persist('meta');
}

/* ============================================================
   UI-примитивы: toast, листы (модальные окна), подтверждение
   ============================================================ */
function toast(msg, type = 'ok', ms = 3200) {
  const host = $('#toasts'); if (!host) return;
  const el = document.createElement('div'); el.className = 'toast ' + type; el.textContent = msg;
  host.appendChild(el); requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 300); }, ms);
}

const Sheet = {
  stack: [],
  open({ title = '', body = '', wide = false, onMount = null, onClose = null, foot = '', locked = false }) {
    const host = $('#sheets');
    const wrap = document.createElement('div'); wrap.className = 'sheet-wrap';
    wrap.innerHTML = `<div class="sheet-bg" ${locked ? '' : 'data-act="sheetClose"'}></div>
      <div class="sheet ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="sheet-grip"></div>
        <div class="sheet-head"><h3>${esc(title)}</h3>${locked ? '' : `<button class="icon-btn" data-act="sheetClose" aria-label="Закрыть">${ic('x')}</button>`}</div>
        <div class="sheet-body">${body}</div>${foot ? `<div class="sheet-foot">${foot}</div>` : ''}
      </div>`;
    host.appendChild(wrap);
    document.body.classList.add('noscroll');
    requestAnimationFrame(() => wrap.classList.add('in'));
    const entry = { wrap, onClose, locked };
    this.stack.push(entry);
    if (onMount) onMount(wrap.querySelector('.sheet'));
    return wrap.querySelector('.sheet');
  },
  close() {
    const e = this.stack.pop(); if (!e) return;
    if (e.wrap.contains(document.activeElement)) document.activeElement.blur();
    e.wrap.classList.remove('in'); setTimeout(() => e.wrap.remove(), 250);
    if (!this.stack.length) document.body.classList.remove('noscroll');
    if (e.onClose) e.onClose();
  },
  closeAll() { while (this.stack.length) this.close(); },
  top() { const e = this.stack[this.stack.length - 1]; return e ? e.wrap.querySelector('.sheet') : null; },
  setBody(html) { const s = this.top(); if (s) s.querySelector('.sheet-body').innerHTML = html; },
};
function confirmDlg(text, okLabel = 'Удалить', danger = true) {
  return new Promise((resolve) => {
    let done = false;
    const s = Sheet.open({
      title: 'Подтверждение', body: `<p class="lead">${esc(text)}</p>`,
      foot: `<button class="btn ghost" data-k="no">Отмена</button><button class="btn ${danger ? 'danger' : 'primary'}" data-k="yes">${esc(okLabel)}</button>`,
      onClose: () => { if (!done) resolve(false); },
    });
    s.querySelector('[data-k=no]').onclick = () => { done = true; resolve(false); Sheet.close(); };
    s.querySelector('[data-k=yes]').onclick = () => { done = true; resolve(true); Sheet.close(); };
  });
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && Sheet.stack.length && !Sheet.stack[Sheet.stack.length - 1].locked) Sheet.close(); });

/* ---------- Делегирование событий ---------- */
const ACT = {};
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-act]'); if (!t) return;
  const fn = ACT[t.dataset.act]; if (!fn) return;
  if (t.tagName === 'A' || t.tagName === 'BUTTON') e.preventDefault();
  try { fn(t, e); } catch (err) { console.error(err); toast('Ошибка: ' + (err.message || err), 'err'); }
});
document.addEventListener('input', (e) => { const t = e.target.closest('[data-in]'); if (t && ACT[t.dataset.in]) ACT[t.dataset.in](t, e); });
document.addEventListener('change', (e) => { const t = e.target.closest('[data-ch]'); if (t && ACT[t.dataset.ch]) ACT[t.dataset.ch](t, e); });
document.addEventListener('submit', (e) => { const f = e.target.closest('form[data-sub]'); if (!f) return; e.preventDefault(); const fn = ACT[f.dataset.sub]; if (fn) { try { fn(f, e); } catch (err) { console.error(err); toast('Ошибка: ' + err.message, 'err'); } } });
ACT.sheetClose = () => Sheet.close();

/* ---------- Формы: проверка ввода ---------- */
function readNum(form, name, { min = -Infinity, max = Infinity, required = true, label = name, int = false } = {}) {
  const el = form.querySelector(`[name="${name}"]`); if (!el) return null;
  el.classList.remove('invalid');
  const raw = el.value.trim();
  if (!raw) { if (required) { markInvalid(el, `Заполните поле «${label}»`); throw new Error('validation'); } return null; }
  const v = num(raw);
  if (!Number.isFinite(v) || v < min || v > max || (int && !Number.isInteger(v))) {
    markInvalid(el, `«${label}»: допустимо от ${min} до ${max}${int ? ' (целое)' : ''}`); throw new Error('validation');
  }
  return v;
}
function readStr(form, name, { required = true, label = name, max = 120 } = {}) {
  const el = form.querySelector(`[name="${name}"]`); if (!el) return '';
  el.classList.remove('invalid');
  const v = el.value.trim();
  if (!v && required) { markInvalid(el, `Заполните поле «${label}»`); throw new Error('validation'); }
  if (v.length > max) { markInvalid(el, `«${label}»: не длиннее ${max} символов`); throw new Error('validation'); }
  return v;
}
function markInvalid(el, msg) { el.classList.add('invalid'); el.focus(); toast(msg, 'err'); }
function validated(fn) { return (...a) => { try { return fn(...a); } catch (e) { if (e.message !== 'validation') { console.error(e); toast('Ошибка: ' + e.message, 'err'); } } }; }

/* ---------- Копирование в буфер (вместо скачивания, если загрузки недоступны) ---------- */
async function copyText(text, okMsg = 'Скопировано') {
  try { await navigator.clipboard.writeText(text); toast(okMsg); return true; }
  catch (e) {
    Sheet.open({ title: 'Скопируйте вручную', body: `<textarea class="input mono" rows="10" readonly>${esc(text)}</textarea>`, onMount: (s) => { const t = s.querySelector('textarea'); t.focus(); t.select(); } });
    return false;
  }
}
let _downloads;
async function saveFile(filename, data, mime = 'text/plain') {
  try {
    if (_downloads === undefined) _downloads = window.claude && window.claude.use ? await withTimeout(window.claude.use('downloads'), 4000).catch(() => null) : null;
    if (_downloads) { await _downloads.save({ filename, data: typeof data === 'string' ? new Blob([data], { type: mime }) : data }); toast('Файл подготовлен: ' + filename); return; }
  } catch (e) { if (e && e.code && /declin|cancel|abort/i.test(e.code + e.message)) { toast('Сохранение отменено', 'warn'); return; } console.warn('download failed', e); }
  // Резерв: обычная ссылка (вне песочницы) или копирование
  try {
    const url = URL.createObjectURL(new Blob([data], { type: mime }));
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    if (window.top !== window) await copyText(typeof data === 'string' ? data : '', 'Скачивание недоступно здесь — данные скопированы в буфер');
  } catch (e) { await copyText(typeof data === 'string' ? data : '', 'Данные скопированы в буфер'); }
}
