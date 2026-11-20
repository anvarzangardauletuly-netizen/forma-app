/* ============================================================
   FORMA — аккаунты и облачная синхронизация на своём сайте (Supabase)
   Работает только вне claude.ai (там свои вход и база).
   • Вход: Google, Apple, e-mail + пароль. Или «без аккаунта» — данные в браузере.
   • Данные: таблица public.docs (user_id, key, data) — те же документы, что и локально.
   • Офлайн: каждый документ сразу пишется в кэш устройства и в очередь отправки;
     очередь уходит в облако, когда появляется сеть.
   • Создатель приложения (таблица public.admins) может читать данные — пользователь
     соглашается с этим при регистрации (Политика конфиденциальности, версия TERMS_VERSION).
   ============================================================ */
'use strict';

const SUPA_URL = 'https://pwqhkdqifyygvjhcqpax.supabase.co';
const SUPA_KEY = 'sb_publishable_OIPfRQLx6iYWOUPwCH06Bg_qj4qP91i'; // публичный ключ: доступ ограничен правилами RLS в базе
const SUPA_LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';
const TERMS_VERSION = '1';

const Supa = {
  client: null, user: null, isAdmin: false, online: navigator.onLine !== false, retryT: null, warned: 0,
  get enabled() { try { return window.self === window.top; } catch (e) { return false; } },
  skipped() { try { return localStorage.getItem(LS + 'noAccount') === '1'; } catch (e) { return false; } },
  async lib() {
    if (this.client) return this.client;
    const sb = await withTimeout(loadScript(SUPA_LIB, 'supabase'), 12000, 'Не удалось загрузить модуль входа');
    this.client = sb.createClient(SUPA_URL, SUPA_KEY, { auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    this.client.auth.onAuthStateChange((ev) => { if (ev === 'PASSWORD_RECOVERY') setTimeout(() => openNewPassword(), 400); });
    return this.client;
  },
  /* Сессия при запуске. Без сети — последний вошедший пользователь из кэша устройства. */
  async session() {
    try {
      const c = await this.lib();
      const { data, error } = await withTimeout(c.auth.getSession(), 10000);
      if (error) throw error;
      if (/[?&](code|error)=/.test(location.search)) history.replaceState(null, '', location.pathname + location.hash);
      const u = data && data.session && data.session.user;
      if (u) { this.user = u; try { localStorage.setItem(LS + 'lastUser', JSON.stringify({ id: u.id, email: u.email })); } catch (e) { /* нет хранилища */ } }
      return u ? { id: u.id, email: u.email, name: (u.user_metadata && (u.user_metadata.full_name || u.user_metadata.name)) || '', offline: false } : null;
    } catch (e) {
      console.warn('auth', e);
      try { const last = JSON.parse(localStorage.getItem(LS + 'lastUser') || 'null'); if (last && last.id) return Object.assign(last, { offline: true }); } catch (e2) { /* нет кэша */ }
      throw e;
    }
  },
  async afterLogin() {
    const c = this.client; if (!c || !this.user) return;
    try {
      const { data: me } = await c.from('members').select('user_id,consent_at').eq('user_id', this.user.id).maybeSingle();
      let consent = null; try { consent = localStorage.getItem(LS + 'consent'); } catch (e) { /* нет */ }
      const row = { user_id: this.user.id, email: this.user.email, name: (D.profile && D.profile.name) || (this.user.user_metadata && this.user.user_metadata.full_name) || null, last_seen: new Date().toISOString() };
      if (!me || !me.consent_at) { row.consent_at = consent ? new Date(+consent).toISOString() : new Date().toISOString(); row.terms_version = TERMS_VERSION; }
      await c.from('members').upsert(row);
      const { data: adm } = await c.from('admins').select('user_id').eq('user_id', this.user.id).maybeSingle();
      this.isAdmin = !!adm; if (this.isAdmin && App.page === 'profile') render();
    } catch (e) { console.warn('members', e); }
  },
  /* Все документы пользователя (постранично) */
  async fetchDocs(uid) {
    const out = {}; const step = 1000;
    for (let from = 0; ; from += step) {
      const { data, error } = await withTimeout(this.client.from('docs').select('key,data').eq('user_id', uid).range(from, from + step - 1), 20000);
      if (error) throw error;
      data.forEach((r) => { out[r.key] = r.data; });
      if (data.length < step) break;
    }
    return out;
  },
  async push(key, job) {
    if (!this.client || !this.user) throw new Error('offline');
    const q = this.client.from('docs');
    const r = job.del ? await q.delete().eq('user_id', this.user.id).eq('key', key)
      : await q.upsert({ user_id: this.user.id, key, data: job.value, updated_at: new Date().toISOString() });
    if (r.error) throw r.error;
  },
  /* Какие способы входа включены в Supabase (Google, Apple…). Кнопки выключенных не показываем. */
  async providers() {
    if (this._prov) return this._prov;
    try {
      const r = await withTimeout(fetch(SUPA_URL + '/auth/v1/settings', { headers: { apikey: SUPA_KEY } }), 8000);
      const j = await r.json(); this._prov = (j && j.external) || {};
      try { localStorage.setItem(LS + 'providers', JSON.stringify(this._prov)); } catch (e) { /* нет хранилища */ }
    } catch (e) {
      try { this._prov = JSON.parse(localStorage.getItem(LS + 'providers') || 'null'); } catch (e2) { this._prov = null; }
    }
    return this._prov || {};
  },
  async signOut() {
    Store.flushAll(); await sleep(600);
    try { if (this.client) await this.client.auth.signOut(); } catch (e) { /* уже вышли */ }
    try { Object.keys(localStorage).filter((k) => k.startsWith(LS + 'u:') || k === LS + 'lastUser').forEach((k) => localStorage.removeItem(k)); } catch (e) { /* нет */ }
    location.replace(location.pathname);
  },
};

/* ---------- Кэш облачных документов на устройстве (по пользователю) ---------- */
const UCache = {
  pre() { return LS + 'u:' + Store.uid + ':'; },
  write(key, job) {
    try {
      const p = this.pre();
      if (job.del) localStorage.removeItem(p + 'd:' + key); else localStorage.setItem(p + 'd:' + key, JSON.stringify(job.value));
      const q = new Set(JSON.parse(localStorage.getItem(p + 'queue') || '[]')); q.add(key); localStorage.setItem(p + 'queue', JSON.stringify([...q]));
    } catch (e) { /* кэш переполнен — облако всё равно получит изменение */ }
  },
  done(key) { try { const p = this.pre(); const q = new Set(JSON.parse(localStorage.getItem(p + 'queue') || '[]')); q.delete(key); localStorage.setItem(p + 'queue', JSON.stringify([...q])); } catch (e) { /* нет */ } },
  queue() { try { return JSON.parse(localStorage.getItem(this.pre() + 'queue') || '[]'); } catch (e) { return []; } },
  read(key) { try { const v = localStorage.getItem(this.pre() + 'd:' + key); return v == null ? undefined : JSON.parse(v); } catch (e) { return undefined; } },
  all() { const out = {}; const p = this.pre() + 'd:'; try { Object.keys(localStorage).forEach((k) => { if (k.startsWith(p)) out[k.slice(p.length)] = JSON.parse(localStorage.getItem(k)); }); } catch (e) { /* нет */ } return out; },
  replaceAll(docs) { try { const p = this.pre() + 'd:'; Object.keys(localStorage).forEach((k) => { if (k.startsWith(p)) localStorage.removeItem(k); }); Object.entries(docs).forEach(([k, v]) => localStorage.setItem(p + k, JSON.stringify(v))); } catch (e) { /* кэш не влез — не страшно */ } },
};

/* Хранилище: подключение Supabase к Store (вызывается из Store.init) */
async function supaInit() {
  let u;
  try { u = await Supa.session(); } catch (e) { Store.authError = 'Не удалось загрузить вход: проверьте интернет.'; return false; }
  if (!u) return false;
  Store.mode = 'cloud'; Store.backend = 'supa'; Store.uid = u.id; Store.email = u.email; Store.me = { name: u.name || '' };
  Store.offline = !!u.offline;
  return true;
}
async function supaLoad() {
  const pending = UCache.queue(); let docs;
  try {
    if (Store.offline || !Supa.client) throw new Error('offline');
    docs = await Supa.fetchDocs(Store.uid);
    pending.forEach((k) => { const v = UCache.read(k); if (v === undefined) delete docs[k]; else docs[k] = v; }); // неотправленные правки главнее
    UCache.replaceAll(docs); pending.forEach((k) => UCache.write(k, docs[k] === undefined ? { del: true } : { value: docs[k] }));
    setTimeout(() => { supaRetry(); Supa.afterLogin(); supaHealthRefresh(); }, 1500);
  } catch (e) {
    console.warn('supa load', e); docs = UCache.all(); Store.offline = true;
    Store.cloudNote = 'Нет связи с облаком — показываю данные с этого устройства. Изменения отправятся, когда появится интернет.';
  }
  Store.migrated = Store.mergeLocal(docs);
  return docs;
}
function supaFlush(key, job) {
  UCache.write(key, job);
  Store.saving++; syncState();
  Store.chains[key] = (Store.chains[key] || Promise.resolve())
    .then(() => Supa.push(key, job)).then(() => { UCache.done(key); if (Store.offline) { Store.offline = false; Store.cloudNote = ''; } })
    .catch((e) => {
      console.warn('supa push', key, e); Store.offline = true;
      if (Date.now() - Supa.warned > 60000) { Supa.warned = Date.now(); toast('Нет связи — сохранено на устройстве, отправлю в облако позже.', 'warn'); }
      clearTimeout(Supa.retryT); Supa.retryT = setTimeout(supaRetry, 30000);
    })
    .finally(() => { Store.saving--; syncState(); });
}
/* Свежие шаги из «Здоровья»: при запуске, при возврате в приложение и каждые 5 минут, пока оно открыто */
async function supaHealthRefresh() {
  if (Store.backend !== 'supa' || !Supa.client || !Supa.user || navigator.onLine === false) return;
  try {
    const from = 'health-' + addDays(todayISO(), -14);
    const { data, error } = await withTimeout(Supa.client.from('docs').select('key,data').eq('user_id', Store.uid).gte('key', from).lte('key', 'health-9'), 15000);
    if (error) throw error;
    let fresh = false;
    (data || []).forEach((r) => { if (!/^health-\d/.test(r.key)) return; const old = D.health[r.key.slice(7)]; if (!old || old.at !== r.data.at) { D.health[r.key.slice(7)] = r.data; fresh = true; } });
    if (fresh && applyHealthSteps() && !Sheet.stack.length) render();
    else if (fresh && App.page === 'steps' && !Sheet.stack.length) render();
  } catch (e) { console.warn('health refresh', e); }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(supaHealthRefresh, 800); });
setInterval(() => { if (document.visibilityState === 'visible') supaHealthRefresh(); }, 5 * 60 * 1000);
async function supaRetry() {
  if (Store.backend !== 'supa') return;
  if (!Supa.client) { try { await Supa.lib(); const u = await Supa.session(); if (!u || u.offline) return; } catch (e) { return; } }
  UCache.queue().forEach((k) => { if (Store.pending[k]) return; const v = UCache.read(k); supaFlush(k, v === undefined ? { del: true } : { value: v }); });
}
window.addEventListener('online', () => setTimeout(supaRetry, 1500));

/* ============================================================
   ЭКРАН ВХОДА
   ============================================================ */
function authHTML() {
  return `<div class="onb fade"><div class="onb-card card auth">
    <div class="logo big"><span class="logo-mark"></span>FORMA</div>
    <h1>Вход в FORMA</h1><p class="muted">Аккаунт хранит дневник, вес и тренировки в облаке — они одинаковые на телефоне и ноутбуке.</p>
    ${Store.authError ? `<div class="banner warn mt12">${ic('info', 18)}<div>${esc(Store.authError)}</div></div>` : ''}
    <label class="consent mt16"><input type="checkbox" id="consent"><span>Я принимаю <a href="#" data-act="privacy">Политику конфиденциальности</a> и согласен, что создатель FORMA может просматривать мои записи (питание, вес, тренировки, активность) для поддержки и улучшения приложения.</span></label>
    <div class="auth-btns mt12" id="authOauth" hidden>
      <button class="btn block lg oauth" data-act="oauth" data-p="google"><svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>Продолжить с Google</button>
      <button class="btn block lg oauth apple" data-act="oauth" data-p="apple"><svg width="18" height="20" viewBox="0 0 17 20" fill="currentColor" aria-hidden="true"><path d="M14.1 10.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.5 1.3-.1 1.8-.8 3.3-.8s2 .8 3.4.8c1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9 0 0-2.7-1-2.7-4zM11.6 3c.7-.9 1.2-2 1-3.2-1 0-2.3.7-3 1.6-.7.8-1.3 2-1.1 3.1 1.2.1 2.3-.6 3.1-1.5z"/></svg>Продолжить с Apple</button>
    </div>
    <div class="or" id="authOr" hidden><span>или e-mail</span></div>
    <form class="form" data-sub="emailAuth">
      <div class="seg"><label><input type="radio" name="mode" value="in" checked><span>Вход</span></label><label><input type="radio" name="mode" value="up"><span>Регистрация</span></label></div>
      <label>E-mail<input class="input" name="email" type="email" autocomplete="email" inputmode="email" maxlength="120"></label>
      <label>Пароль<input class="input" name="pass" type="password" autocomplete="current-password" minlength="6" maxlength="72"></label>
      <button class="btn primary block lg">Продолжить</button>
      <button type="button" class="btn ghost block sm" data-act="resetPass">Забыли пароль?</button>
    </form>
    <button class="btn ghost block mt12" data-act="noAccount">Продолжить без аккаунта</button>
    <p class="muted sm">Без аккаунта данные хранятся только в этом браузере. Войти можно позже в «Профиле» — записи перенесутся.</p>
  </div></div>`;
}
/* После показа экрана входа: оставляем только включённые способы входа */
/* В приложении (Capacitor) адрес страницы — localhost, поэтому письма и вход ведут на сайт FORMA */
function authReturnUrl() { return Native.on ? 'https://forma-app-green-beta.vercel.app/' : location.origin + location.pathname; }
async function authMount() {
  const prov = Native.on ? {} : await Supa.providers(); // вход через Google в приложении подключим отдельно (нужна ссылка-возврат в приложение)
  const box = $('#authOauth'); if (!box) return;
  let shown = 0;
  box.querySelectorAll('[data-act=oauth]').forEach((b) => { const on = !!prov[b.dataset.p]; b.hidden = !on; if (on) shown++; });
  box.hidden = !shown; const or = $('#authOr'); if (or) or.hidden = !shown;
}
function needConsent() {
  const c = $('#consent'); if (c && c.checked) { try { localStorage.setItem(LS + 'consent', String(Date.now())); } catch (e) { /* нет */ } return true; }
  if (c) { c.closest('.consent').classList.add('invalid'); c.focus(); }
  toast('Отметьте согласие с Политикой конфиденциальности', 'err'); return false;
}
ACT.oauth = async (el) => {
  if (!needConsent()) return;
  const name = el.dataset.p === 'apple' ? 'Apple' : 'Google';
  const prov = await Supa.providers();
  if (!prov[el.dataset.p]) { toast(`Вход через ${name} пока не подключён. Войдите по e-mail.`, 'warn', 5000); el.hidden = true; return; }
  try {
    const c = await Supa.lib();
    const { error } = await c.auth.signInWithOAuth({ provider: el.dataset.p, options: { redirectTo: authReturnUrl(), queryParams: el.dataset.p === 'google' ? { prompt: 'select_account' } : undefined } });
    if (error) throw error;
  } catch (e) {
    const off = /not enabled|unsupported provider/i.test((e && e.message) || '');
    toast(off ? `Вход через ${el.dataset.p === 'apple' ? 'Apple' : 'Google'} ещё не подключён. Используйте e-mail.` : 'Ошибка входа: ' + ((e && e.message) || e), 'err', 5000);
  }
};
ACT.emailAuth = async (f) => {
  const mode = f.querySelector('[name=mode]:checked').value; const email = f.email.value.trim(); const pass = f.pass.value;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { markInvalid(f.email, 'Введите корректный e-mail'); return; }
  if (pass.length < 6) { markInvalid(f.pass, 'Пароль — минимум 6 символов'); return; }
  if (mode === 'up' && !needConsent()) return;
  const btn = f.querySelector('.btn.primary'); btn.disabled = true; btn.textContent = 'Подождите…';
  try {
    const c = await Supa.lib();
    if (mode === 'up') {
      const { data, error } = await c.auth.signUp({ email, password: pass, options: { emailRedirectTo: authReturnUrl() } });
      if (error) throw error;
      if (!data.session) { Sheet.open({ title: 'Подтвердите e-mail', body: `<p class="lead">Мы отправили письмо на <b>${esc(email)}</b>.</p><p class="muted">Откройте ссылку из письма на этом устройстве — и вы войдёте. Проверьте папку «Спам».</p>` }); return; }
    } else {
      const { error } = await c.auth.signInWithPassword({ email, password: pass });
      if (error) throw error;
    }
    location.reload();
  } catch (e) {
    const m = (e && e.message) || String(e);
    toast(/invalid login/i.test(m) ? 'Неверный e-mail или пароль' : /already registered/i.test(m) ? 'Этот e-mail уже зарегистрирован — выберите «Вход»' : /not confirmed/i.test(m) ? 'Сначала подтвердите e-mail по ссылке из письма' : 'Ошибка: ' + m, 'err', 5000);
  } finally { btn.disabled = false; btn.textContent = 'Продолжить'; }
};
ACT.resetPass = async () => {
  const f = $('form[data-sub=emailAuth]'); const email = f.email.value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { markInvalid(f.email, 'Сначала введите свой e-mail'); return; }
  try { const c = await Supa.lib(); const { error } = await c.auth.resetPasswordForEmail(email, { redirectTo: authReturnUrl() }); if (error) throw error; toast('Письмо для смены пароля отправлено', 'ok', 5000); }
  catch (e) { toast('Ошибка: ' + ((e && e.message) || e), 'err'); }
};
function openNewPassword() {
  const s = Sheet.open({ title: 'Новый пароль', body: `<form class="form" data-k="f"><label>Новый пароль<input class="input" name="p" type="password" minlength="6" maxlength="72" autocomplete="new-password"></label><button class="btn primary block">Сохранить</button></form>` });
  s.querySelector('[data-k=f]').onsubmit = async (e) => {
    e.preventDefault(); const p = e.target.p.value; if (p.length < 6) { markInvalid(e.target.p, 'Минимум 6 символов'); return; }
    const { error } = await Supa.client.auth.updateUser({ password: p }); if (error) { toast('Ошибка: ' + error.message, 'err'); return; }
    Sheet.close(); toast('Пароль изменён');
  };
}
ACT.noAccount = () => { try { localStorage.setItem(LS + 'noAccount', '1'); } catch (e) { /* нет */ } location.reload(); };
ACT.signIn = () => { try { localStorage.removeItem(LS + 'noAccount'); } catch (e) { /* нет */ } location.reload(); };
ACT.signOut = async () => { if (!(await confirmDlg('Выйти из аккаунта на этом устройстве? Данные останутся в облаке.', 'Выйти', false))) return; Supa.signOut(); };

/* ---------- Политика конфиденциальности ---------- */
const PRIVACY_HTML = `<div class="prose">
  <p class="muted sm">Версия ${TERMS_VERSION} · действует с 17 ноября 2026 г.</p>
  <h4>Какие данные собираются</h4><p>E-mail и имя из аккаунта; то, что вы сами вносите: профиль (возраст, пол, рост, вес, цели), дневник питания, вода, шаги и пробежки, тренировки, заметки, свои продукты и рецепты.</p>
  <h4>Где они хранятся</h4><p>В облачной базе Supabase (сервер в ЕС, Франкфурт) и в кэше вашего устройства для работы без интернета.</p>
  <h4>Кто их видит</h4><p>Вы — со всех своих устройств. <b>Создатель приложения FORMA</b> имеет доступ на чтение ко всем записям пользователей, чтобы поддерживать и улучшать приложение. Другие пользователи ваши данные не видят. Данные не продаются и не передаются третьим лицам.</p>
  <h4>Ваши права</h4><p>Вы можете в любой момент выгрузить свои данные («Профиль → Экспорт») и удалить их («Профиль → Удалить все мои данные»). Для полного удаления аккаунта напишите создателю приложения. Согласие можно отозвать — удалив данные и перестав пользоваться аккаунтом.</p>
  <h4>Важно</h4><p>FORMA не является медицинским сервисом. Расчёты калорий и рекомендации — ориентир, а не назначение врача.</p>
  <p class="muted sm">Согласие даётся в соответствии с Законом РК «О персональных данных и их защите».</p></div>`;
ACT.privacy = () => Sheet.open({ title: 'Политика конфиденциальности', wide: true, body: PRIVACY_HTML });

/* ============================================================
   АДМИН-ПАНЕЛЬ (только для создателя: строка в таблице public.admins)
   ============================================================ */
PAGES.admin = {
  title: 'Пользователи', icon: 'user',
  render() {
    if (!Supa.isAdmin) return emptyState('user', 'Нет доступа', 'Этот раздел доступен только создателю приложения.');
    return `<div class="pagehead"><div><h1>Пользователи</h1><p class="muted">Данные тех, кто дал согласие при регистрации. Только чтение.</p></div><button class="btn" data-act="adminLoad">${ic('timer', 16)}Обновить</button></div>
      <section class="card flush"><div id="adminList"><div class="loading" style="padding:20px">${ic('db', 20)}Загружаю…</div></div></section>`;
  },
  mount() { if (Supa.isAdmin) ACT.adminLoad(); },
};
ACT.adminLoad = async () => {
  const el = $('#adminList'); if (!el) return;
  try {
    const { data, error } = await Supa.client.from('members').select('*').order('last_seen', { ascending: false });
    if (error) throw error;
    el.innerHTML = data.length ? `<div class="list">${data.map((m) => `<div class="li pad" data-act="adminUser" data-id="${esc(m.user_id)}" data-email="${esc(m.email || '')}" role="button">
      <div class="grow"><b>${esc(m.name || m.email || 'Без имени')}</b><small class="muted">${esc(m.email || '')} · был(а) ${m.last_seen ? fmtDate(isoOf(new Date(m.last_seen))).toLowerCase() : '—'} · согласие ${m.consent_at ? isoOf(new Date(m.consent_at)) : 'нет'}</small></div>${ic('right', 16, 'dim')}</div>`).join('')}</div>`
      : emptyState('user', 'Пока никого', 'Пользователи появятся после регистрации.');
  } catch (e) { el.innerHTML = `<div class="banner warn" style="margin:12px">Ошибка загрузки: ${esc(e.message || e)}</div>`; }
};
ACT.adminUser = async (el) => {
  const s = Sheet.open({ title: el.dataset.email || 'Пользователь', wide: true, body: `<div class="loading">${ic('db', 20)}Загружаю данные…</div>` });
  try {
    const docs = await Supa.fetchDocs(el.dataset.id);
    const P = docs.profile || {}; const T = P.targets || {};
    const days = Object.keys(docs).filter((k) => k.startsWith('day-')).map((k) => normDay(docs[k], k.slice(4))).sort((a, b) => (a.date < b.date ? 1 : -1));
    const ws = ((docs.weights && docs.weights.entries) || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    const wos = Object.keys(docs).filter((k) => k.startsWith('wo-')).map((k) => docs[k]).sort((a, b) => (a.date < b.date ? 1 : -1));
    s.querySelector('.sheet-body').innerHTML = `
      <div class="kpis k3"><div><span class="muted">Имя</span><b>${esc(P.name || '—')}</b></div><div><span class="muted">Возраст</span><b>${esc(P.age || '—')}</b></div><div><span class="muted">Цель</span><b>${esc((GOALS && GOALS[P.goal]) || P.goal || '—')}</b></div>
        <div><span class="muted">Норма</span><b>${T.kcal ? fmt(T.kcal) + ' ккал' : '—'}</b></div><div><span class="muted">Вес</span><b>${ws[0] ? fmt(ws[0].kg, 1) + ' кг' : '—'}</b></div><div><span class="muted">Тренировок</span><b>${wos.length}</b></div></div>
      <h4 class="mt16">Питание (последние дни)</h4>
      ${days.length ? `<div class="tscroll"><table class="ntable"><tr><th>Дата</th><th>Ккал</th><th>Б</th><th>Ж</th><th>У</th><th>Вода</th><th>Шаги</th></tr>${days.slice(0, 21).map((d) => { const t = dayTotals(d); return `<tr><td>${fmtShort(d.date)}</td><td>${fmt(t.kcal)}</td><td>${fmt(t.p)}</td><td>${fmt(t.f)}</td><td>${fmt(t.c)}</td><td>${fmt(dayWater(d))}</td><td>${d.steps != null ? fmt(d.steps) : '—'}</td></tr>`; }).join('')}</table></div>` : '<p class="muted">Записей нет.</p>'}
      <h4 class="mt16">Вес</h4>${ws.length ? `<p>${ws.slice(0, 10).map((w) => `${fmtShort(w.date)}: <b>${fmt(w.kg, 1)}</b>`).join(' · ')}</p>` : '<p class="muted">Нет измерений.</p>'}
      <h4 class="mt16">Тренировки</h4>${wos.length ? `<div class="list">${wos.slice(0, 10).map((w) => `<div class="li"><div class="grow"><b>${esc(w.name)}</b><small class="muted">${fmtShort(w.date)} · ${w.durationMin} мин</small></div></div>`).join('')}</div>` : '<p class="muted">Нет тренировок.</p>'}`;
  } catch (e) { s.querySelector('.sheet-body').innerHTML = `<div class="banner warn">Ошибка: ${esc(e.message || e)}</div>`; }
};
