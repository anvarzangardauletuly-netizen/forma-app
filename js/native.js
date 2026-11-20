/* ============================================================
   FORMA — возможности приложения для iPhone/Android (Capacitor).
   На сайте этот файл ничего не делает (Native.on === false).
   • Шаги напрямую из «Здоровья» (HealthKit) и Health Connect — без «Команд».
   • Уведомления о еде и воде приходят, даже когда приложение закрыто.
   • Цвет строки состояния под тему.
   ============================================================ */
'use strict';

const Native = {
  on: !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()),
  platform: window.Capacitor && window.Capacitor.getPlatform ? window.Capacitor.getPlatform() : 'web',
  _p: {},
  plugin(name) { if (!this.on) return null; if (!this._p[name]) this._p[name] = window.Capacitor.registerPlugin(name); return this._p[name]; },
  get isIOS() { return this.platform === 'ios'; },
  get healthName() { return this.isIOS ? '«Здоровье»' : 'Health Connect'; },
};

/* ---------- Шаги из «Здоровья» / Health Connect ---------- */
const NativeHealth = {
  syncing: false, lastSync: 0, lastError: '',
  enabled() { return Native.on && !!settings().healthNative; },
  async available() {
    if (!Native.on) return { available: false, reason: 'web' };
    try { return await Native.plugin('Health').isAvailable(); } catch (e) { return { available: false, reason: e.message || String(e) }; }
  },
  async connect() {
    const H = Native.plugin('Health'); if (!H) return false;
    const av = await this.available();
    if (!av.available) {
      Sheet.open({ title: 'Нет доступа к шагам', body: `<p class="lead">${Native.isIOS ? '«Здоровье» недоступно на этом устройстве.' : 'На телефоне нет Health Connect.'}</p>
        <p class="muted">${Native.isIOS ? 'Шаги можно вводить вручную или включить шагомер.' : 'Установите «Health Connect» из Google Play (на Android 14+ он уже встроен), затем нажмите «Подключить» ещё раз.'}</p>` });
      return false;
    }
    try { await H.requestAuthorization({ read: ['steps'], write: [] }); }
    catch (e) { toast('Доступ не выдан: ' + (e.message || e), 'err'); return false; }
    setSetting('healthNative', true);
    const n = await this.sync(true);
    toast(n != null ? `${Native.healthName} подключено — сегодня ${fmt(n)} шагов` : `${Native.healthName} подключено`);
    render(); return true;
  },
  disconnect() { setSetting('healthNative', false); toast('Шаги из «Здоровья» больше не подтягиваются'); render(); },
  /* Суммы шагов по дням за последнюю неделю → в дневник (правило то же, что для «Команд») */
  async sync(force) {
    if (!this.enabled() || this.syncing) return null;
    if (!force && Date.now() - this.lastSync < 60 * 1000) return null;
    this.syncing = true;
    try {
      const H = Native.plugin('Health');
      const start = parseISO(addDays(todayISO(), -6)); const end = new Date();
      const { samples } = await withTimeout(H.queryAggregated({ dataType: 'steps', startDate: start.toISOString(), endDate: end.toISOString(), bucket: 'day', aggregation: 'sum' }), 20000);
      let changed = false; let today = null;
      (samples || []).forEach((s) => {
        const date = isoOf(new Date(s.startDate)); const n = Math.round(+s.value || 0);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !(n >= 0 && n <= 150000)) return;
        if (date === todayISO()) today = n;
        const cur = D.days[date];
        if (cur && cur.steps === n) return;
        if (!cur || cur.steps == null || cur.stepsSrc === 'health' || n > cur.steps) {
          const d = ensureDay(date); d.steps = n; d.stepsSrc = 'health';
          if ((d.stepsRun || 0) > n) { d.stepsRun = n; d.kmRun = null; }
          saveDay(date); changed = true;
        }
      });
      this.lastSync = Date.now(); this.lastError = '';
      if (changed && booted && !Sheet.stack.length) render();
      return today;
    } catch (e) { console.warn('native health', e); this.lastError = e.message || String(e); return null; }
    finally { this.syncing = false; }
  },
};

/* ---------- Уведомления (еда и вода) — системные, работают при закрытом приложении ---------- */
const NativeNotify = {
  async ensurePermission() {
    const LN = Native.plugin('LocalNotifications'); if (!LN) return false;
    try {
      let p = await LN.checkPermissions(); if (p.display !== 'granted') p = await LN.requestPermissions();
      return p.display === 'granted';
    } catch (e) { return false; }
  },
  /* Пересоздаёт расписание по настройкам «Напоминания» (Профиль) */
  async schedule() {
    const LN = Native.plugin('LocalNotifications'); if (!LN) return;
    try {
      const pend = await LN.getPending(); if (pend.notifications.length) await LN.cancel({ notifications: pend.notifications.map((n) => ({ id: n.id })) });
      const S = settings(); if (!S.rem || !S.rem.on) return;
      if (!(await this.ensurePermission())) { toast('Уведомления выключены в настройках телефона', 'warn'); return; }
      const list = []; const hm = (t) => { const [h, m] = String(t).split(':').map(Number); return Number.isFinite(h) && Number.isFinite(m) ? { hour: h, minute: m } : null; };
      MEALS.forEach((m, i) => { const t = hm(S.rem.meals && S.rem.meals[m.id]); if (t) list.push({ id: 100 + i, title: 'FORMA', body: `${m.name}: не забудьте записать, что съели`, schedule: { on: t, allowWhileIdle: true } }); });
      const every = +S.rem.water || 0; const from = hm(S.rem.from || '09:00'); const to = hm(S.rem.to || '21:00');
      if (every > 0 && from && to) {
        let mins = from.hour * 60 + from.minute + every; const end = to.hour * 60 + to.minute; let k = 0;
        while (mins < end && k < 40) { list.push({ id: 200 + k, title: 'FORMA', body: 'Время выпить стакан воды 💧', schedule: { on: { hour: Math.floor(mins / 60), minute: mins % 60 }, allowWhileIdle: true } }); mins += every; k++; }
      }
      if (list.length) await LN.schedule({ notifications: list });
    } catch (e) { console.warn('notify', e); }
  },
};

/* ---------- Запуск в приложении ---------- */
async function nativeBoot() {
  if (!Native.on) return;
  document.documentElement.classList.add('native', 'native-' + Native.platform);
  try { const SB = Native.plugin('StatusBar'); const dark = document.documentElement.dataset.theme === 'dark'; await SB.setStyle({ style: dark ? 'DARK' : 'LIGHT' }); } catch (e) { /* нет плагина */ }
  try { const App = Native.plugin('App'); App.addListener('appStateChange', ({ isActive }) => { if (isActive) { NativeHealth.sync(); if (typeof supaHealthRefresh === 'function') supaHealthRefresh(); } }); } catch (e) { /* нет плагина */ }
  NativeHealth.sync(true);
  setInterval(() => { if (document.visibilityState === 'visible') NativeHealth.sync(); }, 5 * 60 * 1000);
  NativeNotify.schedule();
}
ACT.healthNativeConnect = () => NativeHealth.connect();
ACT.healthNativeSync = async () => { const n = await NativeHealth.sync(true); toast(n != null ? `Сегодня ${fmt(n)} шагов` : (NativeHealth.lastError ? 'Не удалось прочитать шаги: ' + NativeHealth.lastError : 'Шаги обновлены')); render(); };
ACT.healthNativeOff = () => NativeHealth.disconnect();
