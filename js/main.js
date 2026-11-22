/* ============================================================
   FORMA — каркас приложения: навигация, роутинг, тема, напоминания, запуск
   ============================================================ */
'use strict';

// Внутри claude.ai страница открыта во фрейме — там ссылка на артефакт; на своём сайте — свой адрес
const IN_FRAME = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();
const APP_URL = IN_FRAME ? 'https://claude.ai/artifact/NkmVJqqa1d6Zc7DLTgfyH2' : location.origin + '/';
let booted = false;

const NAV = ['dashboard', 'diary', 'discipline', 'steps', 'foods', 'scan', 'calc', 'weight', 'workouts', 'planner', 'stats', 'ai', 'premium', 'profile'];
const BOTTOM = ['dashboard', 'diary', 'scan', 'workouts'];

function buildShell() {
  $('#side-nav').innerHTML = NAV.map((p) => `<a href="#${p}" class="nav-a" data-p="${p}">${ic(PAGES[p].icon, 20)}<span>${PAGES[p].title}</span></a>`).join('');
  $('#bottom').innerHTML = BOTTOM.map((p) => `<a href="#${p}" class="bn ${p === 'scan' ? 'bn-scan' : ''}" data-p="${p}">${p === 'scan' ? `<span class="bn-fab">${ic('scan', 24)}</span>` : ic(PAGES[p].icon, 22)}<span>${p === 'scan' ? 'Сканер' : PAGES[p].title}</span></a>`).join('')
    + `<button class="bn" data-act="more" data-p="more">${ic('grid', 22)}<span>Ещё</span></button>`;
}
ACT.more = () => {
  const s = Sheet.open({ title: 'Разделы', body: `<div class="more-grid">${NAV.filter((p) => !BOTTOM.includes(p)).map((p) => `<a href="#${p}" class="more-a" data-p="${p}">${ic(PAGES[p].icon, 24)}<span>${PAGES[p].title}</span></a>`).join('')}</div>` });
  s.querySelectorAll('a').forEach((a) => { a.onclick = () => Sheet.closeAll(); });
};
ACT.themeToggle = () => { const cur = document.documentElement.dataset.theme; setSetting('theme', cur === 'dark' ? 'light' : 'dark'); renderChrome(); };

function renderChrome() {
  $$('[data-p]').forEach((a) => a.classList.toggle('on', a.dataset.p === App.page || (a.dataset.p === 'more' && !BOTTOM.includes(App.page))));
  const t = $('#top-title'); if (t) t.textContent = PAGES[App.page] ? PAGES[App.page].title : '';
  ['#themeBtn', '#themeBtnSide'].forEach((s) => { const th = $(s); if (th) th.innerHTML = ic(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon', 20); });
  syncState();
  if (typeof Discipline !== 'undefined' && booted) { Discipline.badge(); setTimeout(() => Discipline.celebrate(), 500); }
}

function go(p) {
  if (!PAGES[p]) p = 'dashboard';
  if (location.hash !== '#' + p) { try { location.hash = p; return; } catch (e) { /* без hash */ } }
  route(p);
}
function route(force) {
  const h = typeof force === 'string' ? force : decodeURIComponent(location.hash.slice(1));
  if (/^steps\?/.test(h)) { if (!booted) return; importStepsFromHash(h); try { history.replaceState(null, '', '#steps'); } catch (e) { /* без истории */ } route('steps'); return; }
  if (/^(food|recipe)-/.test(h)) { if (!booted) return; if (App.page !== 'dashboard' && !PAGES[App.page]) App.page = 'dashboard'; render(); if (D.profile) openDeepLink(h); return; }
  const p = PAGES[h] ? h : 'dashboard';
  if (App.page !== p) { const old = PAGES[App.page]; if (old && old.unmount) old.unmount(); App.page = p; window.scrollTo(0, 0); Sheet.closeAll(); }
  render();
}
window.addEventListener('hashchange', () => route());

function render() {
  if (!booted) return;
  const view = $('#view');
  if (Store.needAuth) { document.body.classList.add('onb-mode'); view.innerHTML = authHTML(); authMount(); return; }
  if (!D.profile) { document.body.classList.add('onb-mode'); view.innerHTML = onboardingHTML(); return; }
  document.body.classList.remove('onb-mode');
  Charts.reset();
  const P = PAGES[App.page] || PAGES.dashboard;
  const y = window.scrollY;
  view.innerHTML = `<div class="page page-${App.page}">${P.render()}</div>`;
  if (P.mount) P.mount();
  renderChrome();
  window.scrollTo(0, y);
}

/* ---------- Тема и акцентный цвет ---------- */
const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
function applyTheme() {
  const S = settings(); const dark = S.theme === 'dark' || (S.theme === 'system' && mq && mq.matches);
  const root = document.documentElement; root.dataset.theme = dark ? 'dark' : 'light';
  const [c, ink] = ACCENTS[S.accent] || ACCENTS.lime;
  root.style.setProperty('--accent', c);
  root.style.setProperty('--accent-ink', dark ? c : ink);
  root.style.setProperty('--on-accent', S.accent === 'blue' ? '#ffffff' : '#0b0b0b');
  const meta = $('meta[name=theme-color]'); if (meta) meta.content = dark ? '#0b0b0b' : '#f3f3f1';
  if (typeof Native !== 'undefined' && Native.on) { try { Native.plugin('StatusBar').setStyle({ style: dark ? 'DARK' : 'LIGHT' }); } catch (e) { /* нет плагина */ } }
}
if (mq && mq.addEventListener) mq.addEventListener('change', () => { applyTheme(); if (booted) render(); });

/* ---------- Напоминания (пока страница открыта) ---------- */
const Reminders = {
  fired: new Set(),
  fire(msg, key) {
    if (key !== 'test' && this.fired.has(key)) return; this.fired.add(key);
    toast('🔔 ' + msg, 'rem', 9000);
    try { if ('Notification' in window && Notification.permission === 'granted') new Notification('FORMA', { body: msg }); } catch (e) { /* недоступно */ }
    try { if (navigator.vibrate) navigator.vibrate(80); } catch (e) { /* нет вибро */ }
  },
  tick() {
    if (!booted || !D.profile || Native.on) return; const S = settings(); if (!S.rem || !S.rem.on) return; // в приложении — системные уведомления (native.js)
    const now = new Date(); const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`; const t = todayISO();
    MEALS.forEach((m) => { const time = S.rem.meals[m.id]; if (time && time === hm && !(getDay(t).meals[m.id] || []).length) this.fire(`${m.name}: не забудьте записать, что съели`, t + m.id + hm); });
    if (+S.rem.water > 0 && hm >= S.rem.from && hm < S.rem.to) {
      const [fh, fm] = S.rem.from.split(':').map(Number); const mins = now.getHours() * 60 + now.getMinutes() - (fh * 60 + fm);
      if (mins > 0 && mins % +S.rem.water === 0 && dayWater(getDay(t)) < targets().water) this.fire(`Время выпить воды — сегодня ${fmt(dayWater(getDay(t)))} из ${fmt(targets().water)} мл`, t + 'w' + hm);
    }
  },
};
setInterval(() => Reminders.tick(), 20000);

/* ---------- Запуск ---------- */
async function boot() {
  try { await I18N.init(); } catch (e) { console.warn(e); }
  buildShell();
  try {
    const docs = await Store.init(); hydrate(docs);
    if (Store.mode === 'cloud' && Store.pendingMigration) {
      (Store.migrated || []).forEach((k) => Store.save(k, docs[k]));
      Store.markMigrated();
      const days = (Store.migrated || []).filter((k) => k.startsWith('day-')).length;
      if ((Store.migrated || []).length) setTimeout(() => toast(`Перенесено в облако из этого браузера: ${Store.migrated.length} записей${days ? `, в т.ч. ${days} дн. дневника` : ''}. Теперь они видны на всех устройствах.`, 'ok', 7000), 800);
    }
  } catch (e) { console.error(e); toast('Не удалось загрузить данные', 'err'); }
  try { applyHealthSteps(); } catch (e) { console.warn(e); }
  applyTheme(); booted = true;
  if (Native.on) nativeBoot();
  Premium.init();
  $('#splash').classList.add('hide'); setTimeout(() => $('#splash') && $('#splash').remove(), 500);
  route();
  if (Store.cloudNote && Store.mode !== 'cloud') setTimeout(() => toast(Store.cloudNote, 'warn', 6000), 600);
  AI.init().then(() => { if (['ai', 'scan', 'diary'].includes(App.page) && !Sheet.stack.length) render(); });
  StoreFoods.load().then(() => { if (['foods', 'scan'].includes(App.page) && !Sheet.stack.length) render(); });
}
document.addEventListener('DOMContentLoaded', boot);

/* ---------- Офлайн и установка на телефон (PWA) ----------
   На своём сайте (не во фрейме claude.ai) регистрируется service worker: все файлы приложения
   кэшируются, и FORMA открывается и работает без интернета. */
/* Готовый APK для Android — собирается автоматически (GitHub Actions → релиз android-latest) */
const APK_URL = 'https://github.com/anvarzangardauletuly-netizen/forma-app/releases/download/android-latest/FORMA.apk';
const IS_ANDROID = /Android/i.test(navigator.userAgent);
function appDownloadHTML() {
  if (Native.on || IN_FRAME) return '';
  return `<section class="card"><div class="card-h"><h3>${ic('download', 18)}Приложение FORMA</h3></div>
    <div class="list"><a class="li pad" href="${APK_URL}" rel="noopener"><div class="grow"><b>Скачать для Android</b><small class="muted">Файл FORMA.apk · откройте его на телефоне и разрешите установку. Войдите в аккаунт — данные подтянутся.</small></div>${ic('download', 18, 'dim')}</a>
      <div class="li pad"><div class="grow"><b>iPhone</b><small class="muted">Откройте сайт в Safari → «Поделиться» → «На экран „Домой“». Версия в App Store — после публикации.</small></div></div></div></section>`;
}
const PWA = {
  prompt: null, standalone: false,
  init() {
    this.standalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    if (!IN_FRAME && !Native.on && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('sw.js').then((reg) => {
        // Проверяем обновление при каждом возврате в приложение и раз в 30 минут
        const check = () => reg.update().catch(() => {});
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
        setInterval(check, 30 * 60 * 1000);
      }).catch((e) => console.warn('sw', e));
      // Новая версия установилась — перезагружаем страницу (данные уже сохранены)
      let hadController = !!navigator.serviceWorker.controller; let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController) { hadController = true; return; }
        if (reloading) return; reloading = true;
        Store.flushAll(); toast('Вышла новая версия FORMA — обновляю…', 'ok', 2000);
        setTimeout(() => location.reload(), Sheet.stack.length ? 4000 : 800);
      });
    }
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); this.prompt = e; if (booted && App.page === 'dashboard') render(); });
    window.addEventListener('appinstalled', () => { this.prompt = null; this.standalone = true; toast('FORMA установлена на экран «Домой»'); render(); });
    window.addEventListener('offline', () => toast('Нет интернета. FORMA продолжает работать — всё сохраняется на телефоне.', 'warn', 5000));
    window.addEventListener('online', () => toast('Интернет снова есть'));
  },
  canShow() {
    if (IN_FRAME || this.standalone || Native.on) return false;
    try { if (localStorage.getItem('forma:installHidden')) return false; } catch (e) { /* нет хранилища */ }
    return !!this.prompt || IS_ANDROID || /iPhone|iPad|iPod/.test(navigator.userAgent);
  },
  bannerHTML() {
    if (!this.canShow()) return '';
    if (IS_ANDROID) {
      return `<div class="banner install fade">${ic('download', 20)}<div class="grow"><b>FORMA для Android</b><p class="muted sm">Настоящее приложение: шаги из Health Connect, напоминания, работа без интернета.</p>
        <a class="btn primary sm mt8" href="${APK_URL}" rel="noopener">Скачать приложение</a></div><button class="icon-btn sm" data-act="pwaHide" aria-label="Скрыть">${ic('x', 16)}</button></div>`;
    }
    const ios = !this.prompt;
    return `<div class="banner install fade">${ic('download', 20)}<div class="grow"><b>Установите FORMA как приложение</b><p class="muted sm">${ios ? 'В Safari нажмите «Поделиться» <span class="ios-share"></span> → «На экран „Домой“». Приложение откроется на весь экран и будет работать без интернета.' : 'Иконка на экране, полный экран и работа без интернета.'}</p>
      ${ios ? '' : '<button class="btn primary sm mt8" data-act="pwaInstall">Установить</button>'}</div><button class="icon-btn sm" data-act="pwaHide" aria-label="Скрыть">${ic('x', 16)}</button></div>`;
  },
};
ACT.pwaInstall = async () => { if (!PWA.prompt) return; PWA.prompt.prompt(); try { await PWA.prompt.userChoice; } catch (e) { /* отмена */ } PWA.prompt = null; render(); };
ACT.pwaHide = () => { try { localStorage.setItem('forma:installHidden', '1'); } catch (e) { /* нет хранилища */ } render(); };
PWA.init();
