/* ============================================================
   FORMA — шаги: шагомер (ходьба / бег / транспорт), пробежки,
   перенос шагов из «Здоровья», страница «Шаги».
   Работает полностью офлайн: датчик движения и GPS не требуют интернета.
   ============================================================ */
'use strict';

function stepsSummaryHTML(day, T, burned) {
  const sp = dayStepParts(day);
  const done = day.steps >= T.steps;
  return `<div class="bignum"><span data-live="steps">${fmt(day.steps)}</span><small> из ${fmt(T.steps)}</small>${done ? ' <span class="tag ok">цель выполнена</span>' : ''}</div>${Charts.bar(day.steps, T.steps, 'var(--accent)', true)}
    <div class="step-split mt8"><span><i class="sw"></i>Ходьба ${fmt(sp.walk)} · ${fmt(sp.kmWalk, 1)} км</span>${sp.run ? `<span><i class="sr"></i>Бег ${fmt(sp.run)} · ${fmt(sp.kmRun, 1)} км</span>` : ''}</div>
    <p class="muted sm mt8">≈ ${fmt(burned.steps)} ккал${settings().stepsInBudget !== false && burned.stepsExtra >= 1 ? ` · +${fmt(burned.stepsExtra)} ккал к норме` : ''}</p>`;
}

/* ------------------------------------------------------------
   Шагомер.
   1) Сигнал: модуль ускорения минус медленная оценка гравитации, сглаженный фильтром.
   2) Шаг-кандидат — пик выше адаптивного порога, не чаще 4 раз в секунду.
   3) Шаги засчитываются только серией из 6+ ритмичных шагов (разброс интервалов < 30%).
      Тряска в автобусе, машине, метро и движения рукой неритмичны — не считаются.
   4) Бег: темп от ~145 шагов/мин и сильный толчок. Ходьба — всё остальное.
   5) С GPS: скорость выше 20 км/ч без ритма шагов = транспорт, шаги на паузе.
   ------------------------------------------------------------ */
const Pedo = {
  on: false, kind: 'auto', state: 'idle', gps: false,
  g: 9.81, lp: 0, peak: 0, above: false, lastPeakAt: 0, amps: [],
  pend: [], confirmed: false, lastStepAt: 0,
  session: null, wake: null, geoId: null, geo: null, speed: 0, gotEvent: false, saveAt: 0, uiTimer: null, hiddenAt: 0,

  handler(e) {
    const a = e.accelerationIncludingGravity; if (!a || a.x == null) return;
    Pedo.gotEvent = true;
    const m = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
    Pedo.g = Pedo.g * 0.985 + m * 0.015;
    Pedo.lp = Pedo.lp * 0.65 + (m - Pedo.g) * 0.35;
    const now = e.timeStamp || performance.now();
    const thr = Math.max(1.0, Pedo.ampAvg() * 0.45);
    if (Pedo.lp > thr) { Pedo.above = true; if (Pedo.lp > Pedo.peak) Pedo.peak = Pedo.lp; }
    else if (Pedo.above && Pedo.lp < thr * 0.3) {
      if (now - Pedo.lastPeakAt > 240) Pedo.candidate(now, Pedo.peak);
      Pedo.above = false; Pedo.peak = 0;
    }
  },
  ampAvg() { if (!this.amps.length) return 2; return this.amps.reduce((s, v) => s + v, 0) / this.amps.length; },
  cv(arr) { const n = arr.length; if (n < 2) return 1; const mu = arr.reduce((s, v) => s + v, 0) / n; const sd = Math.sqrt(arr.reduce((s, v) => s + (v - mu) * (v - mu), 0) / n); return mu ? sd / mu : 1; },

  candidate(t, amp) {
    this.lastPeakAt = t;
    this.amps.push(amp); if (this.amps.length > 12) this.amps.shift();
    if (this.gps && this.speed > 5.5 && !this.confirmed) { this.pend = []; this.setState('vehicle'); return; }
    const last = this.pend[this.pend.length - 1];
    if (!last || t - last.t > 2000) { this.pend = [{ t, amp }]; this.confirmed = false; return; }
    this.pend.push({ t, amp }); if (this.pend.length > 10) this.pend.shift();
    const iv = []; for (let i = 1; i < this.pend.length; i++) iv.push(this.pend[i].t - this.pend[i - 1].t);
    const recent = iv.slice(-5);
    if (!this.confirmed) {
      if (this.pend.length >= 6 && this.cv(recent) < 0.3) { this.confirmed = true; this.commit(this.pend.length, recent, this.pend); }
    } else if (this.cv(recent) < 0.4) this.commit(1, recent, this.pend.slice(-1));
    else { this.confirmed = false; this.pend = [{ t, amp }]; }
  },

  commit(n, iv, pts) {
    const sorted = [...iv].sort((a, b) => a - b); const med = sorted[Math.floor(sorted.length / 2)] || 600;
    const cadence = 60000 / med;
    const amp = pts.reduce((s, p) => s + p.amp, 0) / pts.length;
    const run = this.kind === 'run' ? cadence >= 125 : (cadence >= 145 && amp >= 3) || amp >= 7;
    const kind = run ? 'run' : 'walk';
    const d = ensureDay(todayISO());
    d.steps = (d.steps || 0) + n; d.stepsSrc = d.stepsSrc && d.stepsSrc !== 'sensor' ? 'mixed' : 'sensor';
    const km = n * strideM(kind) * (kind === 'run' ? clamp(cadence / 165, 0.8, 1.25) : clamp(cadence / 110, 0.85, 1.15)) / 1000;
    if (kind === 'run') { d.stepsRun = (d.stepsRun || 0) + n; d.kmRun = Math.round(((d.kmRun != null ? d.kmRun : 0) + km) * 10000) / 10000; }
    const S = this.session; if (S) { S.steps += n; S[kind] += n; S.km[kind] += km; S.cadence = cadence; }
    this.lastStepAt = Date.now(); this.cadence = cadence; this.setState(kind);
    if (Date.now() - this.saveAt > 15000) { this.saveAt = Date.now(); saveDay(todayISO()); }
    this.ui();
  },

  setState(s) { if (this.state !== s) { this.state = s; this.ui(); } },
  tick() {
    if (!this.on) return;
    if (Date.now() - this.lastStepAt > 3500 && ['walk', 'run'].includes(this.state)) this.setState(this.gps && this.speed > 5.5 ? 'vehicle' : 'still');
    if (this.state === 'vehicle' && this.speed < 3) this.setState('still');
    if (this.state === 'idle') this.setState('still');
    this.ui();
  },

  async start(kind = 'auto') {
    try {
      if (typeof DeviceMotionEvent === 'undefined') throw new Error('no');
      if (typeof DeviceMotionEvent.requestPermission === 'function') { const r = await DeviceMotionEvent.requestPermission(); if (r !== 'granted') throw new Error('denied'); }
      this.gotEvent = false; window.addEventListener('devicemotion', this.handler);
      await sleep(1500);
      if (!this.gotEvent) { window.removeEventListener('devicemotion', this.handler); throw new Error('silent'); }
    } catch (e) { this.unavailable(e && e.message); return; }
    this.on = true; this.kind = kind; this.state = 'still'; this.pend = []; this.confirmed = false; this.lastStepAt = 0; this.amps = [];
    this.session = { kind, start: Date.now(), steps: 0, walk: 0, run: 0, km: { walk: 0, run: 0 }, gpsKm: 0, cadence: 0 };
    this.gps = !!settings().pedoGps; if (this.gps || kind === 'run') this.geoStart();
    this.keepAwake();
    clearInterval(this.uiTimer); this.uiTimer = setInterval(() => this.tick(), 1000);
    toast(kind === 'run' ? 'Пробежка началась. Держите приложение открытым.' : 'Шагомер включён. Считает, пока приложение открыто.');
    render();
  },

  stop(silent) {
    if (!this.on) return;
    window.removeEventListener('devicemotion', this.handler);
    this.on = false; this.state = 'idle'; clearInterval(this.uiTimer); this.geoStop(); this.release();
    const S = this.session; this.session = null;
    const d = ensureDay(todayISO());
    if (S && S.kind === 'run') {
      const min = Math.max(1, Math.round((Date.now() - S.start) / 60000));
      const km = S.gpsKm > 0.2 ? S.gpsKm : S.km.run + S.km.walk;
      if (S.steps >= 30 || km >= 0.1) {
        if (S.gpsKm > 0.2 && S.km.run > 0) d.kmRun = r2(Math.max(0, (d.kmRun || 0) - S.km.run + Math.min(S.gpsKm, S.gpsKm * S.run / Math.max(1, S.steps))));
        d.runs = d.runs || []; d.runs.push({ id: uid(), start: S.start, min, km: r2(km), steps: S.steps, gps: S.gpsKm > 0.2 });
        if (!silent) toast(`Пробежка сохранена: ${fmt(km, 2)} км за ${min} мин`);
      }
    } else if (!silent) toast(S && S.steps ? `Шагомер выключен. Засчитано ${fmt(S.steps)} шагов.` : 'Шагомер выключен');
    saveDay(todayISO()); render();
  },

  unavailable(reason) {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const msg = reason === 'denied' ? 'Доступ к датчику движения запрещён. Нажмите «Шагомер» ещё раз и выберите «Разрешить».'
      : 'Это устройство или браузер не передаёт данные датчика движения, поэтому шаги не считаются автоматически.';
    Sheet.open({ title: 'Шагомер недоступен', body: `<p class="lead">${msg}</p>
      <p class="muted">${ios ? 'На iPhone можно перенести шаги из приложения «Здоровье» — оно считает их весь день, даже когда FORMA закрыта.' : 'Шаги можно ввести вручную из приложения шагов на телефоне или часах.'}</p>
      <div class="row gap8 mt12 wrap"><button class="btn primary" data-act="stepsEditFromPedo">Ввести вручную</button><a class="btn" href="#steps" data-act="sheetClose">Как перенести из «Здоровья»</a></div>` });
  },

  /* GPS — только для дистанции пробежки и распознавания транспорта. Работает без интернета. */
  geoStart() {
    if (!('geolocation' in navigator)) return;
    this.geo = null; this.speed = 0;
    try {
      this.geoId = navigator.geolocation.watchPosition((p) => {
        const c = p.coords; if (c.accuracy > 35) return;
        const pt = { lat: c.latitude, lon: c.longitude, t: p.timestamp };
        if (this.geo) {
          const dkm = haversineKm(this.geo, pt); const dt = (pt.t - this.geo.t) / 1000;
          const v = c.speed != null && c.speed >= 0 ? c.speed : (dt > 0 ? dkm * 1000 / dt : 0);
          this.speed = this.speed * 0.5 + v * 0.5;
          if (this.session && dkm < 0.2 && this.speed < 7) this.session.gpsKm += dkm; // < 25 км/ч — человек, а не транспорт
        }
        this.geo = pt; this.ui();
      }, () => { this.geoId = null; }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
    } catch (e) { this.geoId = null; }
  },
  geoStop() { if (this.geoId != null) { try { navigator.geolocation.clearWatch(this.geoId); } catch (e) { /* нет */ } } this.geoId = null; this.speed = 0; },

  /* Экран не гаснет, пока идёт подсчёт (браузер останавливает датчики при выключенном экране) */
  async keepAwake() { try { if ('wakeLock' in navigator) { this.wake = await navigator.wakeLock.request('screen'); } } catch (e) { this.wake = null; } },
  release() { try { if (this.wake) this.wake.release(); } catch (e) { /* уже снят */ } this.wake = null; },

  ui() {
    const S = this.session; const el = (id) => document.getElementById(id);
    const st = el('pd-state');
    const L = { idle: ['Выключен', ''], still: ['Стоите', 'still'], walk: ['Ходьба', 'walk'], run: ['Бег', 'run'], vehicle: ['Транспорт — шаги не считаются', 'veh'] }[this.state] || ['', ''];
    if (st) { st.textContent = L[0]; st.className = 'pd-state ' + L[1]; }
    const day = getDay(todayISO());
    document.querySelectorAll('[data-live=steps]').forEach((n) => { n.textContent = fmt(day.steps || 0); });
    if (S) {
      if (el('pd-sess')) el('pd-sess').textContent = fmt(S.steps);
      const sec = Math.round((Date.now() - S.start) / 1000);
      if (el('pd-time')) el('pd-time').textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
      const km = S.gpsKm > 0.2 ? S.gpsKm : S.km.walk + S.km.run;
      if (el('pd-km')) el('pd-km').textContent = fmt(km, 2);
      if (el('pd-cad')) el('pd-cad').textContent = this.state === 'walk' || this.state === 'run' ? fmt(this.cadence || 0) : '—';
      if (el('pd-pace')) el('pd-pace').textContent = km > 0.05 ? paceStr(sec / 60 / km) : '—';
      if (el('pd-split')) el('pd-split').textContent = `ходьба ${fmt(S.walk)} · бег ${fmt(S.run)}`;
    }
  },
};
function haversineKm(a, b) {
  const R = 6371; const toR = (x) => x * Math.PI / 180;
  const dLat = toR(b.lat - a.lat); const dLon = toR(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function paceStr(minPerKm) { if (!Number.isFinite(minPerKm) || minPerKm > 60) return '—'; const m = Math.floor(minPerKm); const s = Math.round((minPerKm - m) * 60); return `${m}:${String(s === 60 ? 59 : s).padStart(2, '0')}`; }
function r2(x) { return Math.round(x * 100) / 100; }

document.addEventListener('visibilitychange', () => {
  if (!Pedo.on) return;
  if (document.visibilityState === 'hidden') { Pedo.hiddenAt = Date.now(); saveDay(todayISO()); }
  else {
    Pedo.keepAwake();
    if (Pedo.hiddenAt && Date.now() - Pedo.hiddenAt > 20000) toast('Пока приложение было свёрнуто, шаги не считались — браузер отключает датчики в фоне.', 'warn', 6000);
    Pedo.hiddenAt = 0;
  }
});
window.addEventListener('pagehide', () => { if (Pedo.on) saveDay(todayISO()); });

ACT.pedometer = () => (Pedo.on ? Pedo.stop() : Pedo.start('auto'));
ACT.runStart = () => (Pedo.on ? Pedo.stop() : Pedo.start('run'));
ACT.stepsEditFromPedo = () => { Sheet.close(); ACT.stepsEdit(); };
ACT.pedoGps = (el) => { setSetting('pedoGps', el.checked); if (Pedo.on) { Pedo.gps = el.checked; if (el.checked) Pedo.geoStart(); else if (Pedo.kind !== 'run') Pedo.geoStop(); } };
ACT.runDel = (el) => { const d = ensureDay(el.dataset.date); d.runs = (d.runs || []).filter((r) => r.id !== el.dataset.id); saveDay(el.dataset.date); render(); };

/* ------------------------------------------------------------
   Перенос из «Здоровья» (iPhone, приложение «Команды») или любого
   приложения шагов: через буфер обмена или ссылку #steps?n=8432
   ------------------------------------------------------------ */
function parseStepsText(t) {
  const s = String(t || '').replace(/[\s  ]/g, '').replace(',', '.');
  const m = s.match(/\d+(\.\d+)?/); if (!m) return null;
  const v = Math.round(parseFloat(m[0])); return v >= 0 && v <= 150000 ? v : null;
}
function applyImportedSteps(n, date, src) {
  const d = ensureDay(date || todayISO()); d.steps = n; d.stepsSrc = src;
  if ((d.stepsRun || 0) > n) { d.stepsRun = n; d.kmRun = null; }
  saveDay(date || todayISO());
}
function importStepsFromHash(h) {
  const q = new URLSearchParams(h.split('?')[1] || '');
  const n = parseStepsText(q.get('n')); const date = /^\d{4}-\d{2}-\d{2}$/.test(q.get('d') || '') ? q.get('d') : todayISO();
  if (n == null) { toast('В ссылке нет количества шагов', 'err'); return; }
  applyImportedSteps(n, date, 'health'); toast(`Шаги из «Здоровья»: ${fmt(n)}`);
}
ACT.stepsPaste = async () => {
  let t = '';
  try { t = await navigator.clipboard.readText(); } catch (e) { t = ''; }
  const n = parseStepsText(t);
  if (n == null) {
    Sheet.open({ title: 'Вставьте число шагов', body: `<form data-sub="stepsPasteSave" class="form"><label>Шаги из «Здоровья»<input class="input" name="steps" inputmode="numeric" placeholder="Нажмите и выберите «Вставить»"></label><p class="muted sm">Браузер не дал прочитать буфер обмена. Вставьте число в поле вручную.</p><button class="btn primary block">Сохранить</button></form>` });
    return;
  }
  applyImportedSteps(n, todayISO(), 'health'); toast(`Шаги за сегодня: ${fmt(n)}`); render();
};
ACT.stepsPasteSave = validated((f) => { const v = readNum(f, 'steps', { min: 0, max: 150000, label: 'Шаги', int: true }); applyImportedSteps(v, todayISO(), 'health'); Sheet.close(); render(); toast(`Шаги за сегодня: ${fmt(v)}`); });
ACT.stepsLinkCopy = () => copyText(location.origin + location.pathname + '#steps?n=');

/* ------------------------------------------------------------
   Автосинхронизация шагов из «Здоровья» (iPhone): «Команды» по расписанию
   открывают личную ссылку → функция Supabase health-steps → документ health-ДАТА.
   ------------------------------------------------------------ */
const healthFn = () => SUPA_URL + '/functions/v1/health-steps'; // SUPA_URL объявлен в account.js (грузится позже)
function healthShortcutName() { return (settings().healthShortcut || 'FORMA').trim() || 'FORMA'; }
/* Кнопка «Обновить шаги»: запускает команду iPhone и возвращает в FORMA (x-callback-url) */
function healthRefreshBtn(cls = 'btn sm') {
  if (!(Store.backend === 'supa' && Supa.user && D['health-token'])) return '';
  return `<button class="${cls}" data-act="healthRun">${ic('heart', 16)}Обновить из «Здоровья»</button>`;
}
ACT.healthRun = () => {
  const back = location.origin + location.pathname + '#' + (App.page || 'steps');
  const url = `shortcuts://x-callback-url/run-shortcut?name=${encodeURIComponent(healthShortcutName())}&x-success=${encodeURIComponent(back)}&x-error=${encodeURIComponent(back)}`;
  toast('Открываю «Команды»… вернётесь сюда автоматически', 'ok', 2500);
  [1500, 4000, 8000].forEach((ms) => setTimeout(() => { if (typeof supaHealthRefresh === 'function') supaHealthRefresh(); }, ms));
  location.href = url;
};
ACT.healthName = (el) => { const v = el.value.trim().slice(0, 60); setSetting('healthShortcut', v || 'FORMA'); toast(`Команда: «${v || 'FORMA'}»`); };
function healthTokenLocal() { try { return localStorage.getItem(LS + 'healthToken:' + Store.uid) || ''; } catch (e) { return ''; } }
function healthLink(t) { return `${healthFn()}?t=${t}&n=`; }
function healthSyncHTML(ios) {
  const signed = Store.backend === 'supa' && Supa.user;
  const doc = D['health-token']; const tok = healthTokenLocal(); const last = lastHealthSync();
  const lastTxt = last ? `Последнее обновление: ${fmtDate(last.date).toLowerCase()}, ${new Date(last.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} — ${fmt(last.steps)} шагов` : 'Данных из «Здоровья» пока не было.';
  let body;
  if (!signed) body = `<p class="muted">Шаги из «Здоровья» приходят через ваш аккаунт FORMA. Войдите в аккаунт (Профиль → «Войти»), и здесь появится настройка.</p>`;
  else if (doc && tok) body = `
    <div class="banner ${last ? 'ok' : 'info'}">${ic(last ? 'check' : 'info', 18)}<div>${lastTxt}<br><small class="muted">FORMA сама подтягивает шаги при открытии и каждые 5 минут.</small></div></div>
    <div class="row gap8 mt12 wrap">${healthRefreshBtn('btn primary')}</div>
    <label class="form mt8"><small class="muted">Название вашей команды в «Командах» (для кнопки выше)</small><input class="input" value="${esc(healthShortcutName())}" data-ch="healthName" maxlength="60"></label>
    <p class="mt12"><b>Ваша личная ссылка</b> <small class="muted">— никому её не отправляйте</small></p>
    <div class="row gap8"><input class="input mono sm grow" readonly value="${esc(healthLink(tok))}" data-k="hl"><button class="btn sm primary" data-act="healthCopy">${ic('copy', 16)}Копировать</button></div>
    <details class="mt12" ${last ? '' : 'open'}><summary><b>Как настроить на iPhone (один раз, ~3 минуты)</b></summary>
    <ol class="steps-list">
      <li>Нажмите «Копировать» выше.</li>
      <li>Откройте приложение <b>«Команды»</b> → вкладка «Команды» → <b>«+»</b>.</li>
      <li>«Добавить действие» → найдите <b>«Найти образцы здоровья»</b>. Нажмите «Тип» → <b>«Шаги»</b>. Добавьте фильтр <b>«Дата начала»</b> → <b>«Сегодня»</b>.</li>
      <li>Добавьте действие <b>«Вычислить статистику»</b> → выберите <b>«Сумма»</b>.</li>
      <li>Добавьте действие <b>«Получить содержимое URL»</b>. В поле адреса вставьте скопированную ссылку, поставьте курсор в самый конец (после <span class="mono">n=</span>) и над клавиатурой нажмите <b>«Статистика»</b>.</li>
      <li>Назовите команду <b>«FORMA»</b> и нажмите ▶. Разрешите доступ к «Здоровью». Если всё верно, появится «FORMA: … шагов сохранено».</li>
      <li>Вкладка <b>«Автоматизация»</b> → <b>«+»</b> → <b>«Время суток»</b> → например, 12:00, «Ежедневно» → <b>«Запускать сразу»</b> → «Далее» → выберите «FORMA». Сделайте так же ещё на несколько времён (например, каждые 2–3 часа) и обязательно на 23:50 — последний запуск сохранит итог дня. А когда нужно прямо сейчас — нажмите «Обновить из „Здоровья“».</li>
    </ol></details>
    <button class="btn ghost sm mt12" data-act="healthCreate">Создать новую ссылку</button>
    <p class="muted sm">Новая ссылка отключает старую — тогда вставьте её в команду заново.</p>`;
  else body = `
    <p class="muted">iPhone считает шаги весь день сам — даже без интернета и когда FORMA закрыта. Подключите «Здоровье» один раз, и шаги будут сами появляться здесь несколько раз в день.</p>
    ${doc ? `<div class="banner warn mt12">Ссылка уже создана на другом устройстве. Можно создать новую здесь — старая перестанет работать.</div><div class="row gap8 mt12 wrap">${healthRefreshBtn()}</div>` : ''}
    <button class="btn primary mt12" data-act="healthCreate">${ic('heart', 18)}${doc ? 'Создать новую ссылку' : 'Подключить «Здоровье»'}</button>`;
  return `<section class="card fade">
      <div class="card-h"><div><h3>${ic('heart', 18)}Шаги из «Здоровья» автоматически</h3><small class="muted">${ios ? 'iPhone, через приложение «Команды»' : 'для iPhone (на Android — вставка вручную ниже)'}</small></div></div>
      ${body}
    </section>`;
}
ACT.healthCreate = async () => {
  if (!(Store.backend === 'supa' && Supa.user)) { toast('Сначала войдите в аккаунт', 'warn'); return; }
  if (D['health-token'] && !(await confirmDlg('Создать новую ссылку? Старая перестанет работать — её нужно будет заменить в команде «FORMA».', 'Создать', false))) return;
  try {
    const raw = new Uint8Array(24); crypto.getRandomValues(raw);
    const tok = btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(tok));
    const hash = [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
    D['health-token'] = { kind: 'health-token', hash, created: Date.now() }; persist('health-token'); Store.flushAll();
    try { localStorage.setItem(LS + 'healthToken:' + Store.uid, tok); } catch (e) { /* без хранилища ссылка покажется только сейчас */ }
    render(); toast('Ссылка готова — теперь настройте команду по инструкции');
  } catch (e) { console.error(e); toast('Не удалось создать ссылку: ' + (e.message || e), 'err'); }
};
ACT.healthCopy = () => { const t = healthTokenLocal(); if (t) copyText(healthLink(t), 'Ссылка скопирована'); };

/* ------------------------------------------------------------
   Страница «Шаги»
   ------------------------------------------------------------ */
PAGES.steps = {
  title: 'Шаги', icon: 'steps',
  render() {
    const date = todayISO(); const day = getDay(date); const T = targets(); const burned = dayBurned(date);
    const S = settings(); const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const sess = Pedo.session; const running = Pedo.on && Pedo.kind === 'run';
    const runs = (day.runs || []).slice().reverse();
    const avg7 = (() => { const v = []; for (let i = 1; i <= 7; i++) { const x = getDay(addDays(date, -i)).steps; if (x != null) v.push(x); } return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; })();
    return `
    <div class="pagehead"><div><h1>Шаги и бег</h1><p class="muted">Ходьба и бег считаются отдельно. Тряска в транспорте не засчитывается.</p></div></div>
    <div class="grid g2">
      <section class="card fade">
        <div class="card-h"><h3>${ic('steps', 18)}Сегодня</h3><button class="link-btn" data-act="stepsGoalEdit">цель ${fmt(T.steps)} ${ic('edit', 14)}</button></div>
        ${day.steps != null ? stepsSummaryHTML(day, T, burned) : '<div class="bignum"><span data-live="steps">0</span><small> шагов</small></div><p class="muted sm mt8">Пока нет данных за сегодня.</p>'}
        ${avg7 != null ? `<p class="muted sm">В среднем за 7 дней: ${fmt(avg7)} шагов</p>` : ''}
        <div class="row gap8 mt12 wrap"><button class="btn sm primary" data-act="stepsEdit">${ic('edit', 16)}${day.steps != null ? 'Изменить шаги' : 'Ввести шаги'}</button><button class="btn sm" data-act="stepsGoalEdit">${ic('flame', 16)}Цель шагов</button>${healthRefreshBtn()}</div>
      </section>

      <section class="card fade pd-card ${Pedo.on ? 'live' : ''}">
        <div class="card-h"><h3>${ic('timer', 18)}${running ? 'Пробежка' : 'Шагомер'}</h3><span id="pd-state" class="pd-state">${Pedo.on ? '' : 'Выключен'}</span></div>
        ${Pedo.on && sess ? `
          <div class="pd-live">
            <div><b id="pd-sess">${fmt(sess.steps)}</b><span>шагов за сессию</span></div>
            <div><b id="pd-km">0</b><span>км</span></div>
            <div><b id="pd-time">0:00</b><span>время</span></div>
            <div><b id="pd-${running ? 'pace' : 'cad'}">—</b><span>${running ? 'темп, мин/км' : 'шагов/мин'}</span></div>
          </div>
          <p class="muted sm" id="pd-split"></p>
          <button class="btn danger block mt12" data-act="${running ? 'runStart' : 'pedometer'}">${running ? 'Закончить пробежку' : 'Остановить'}</button>`
        : `<p class="muted">Считает шаги, пока FORMA открыта: держите телефон в кармане или руке. Экран не будет гаснуть во время подсчёта.</p>
          <div class="f2 mt12"><button class="btn primary" data-act="pedometer">${ic('steps', 18)}Шагомер</button><button class="btn" data-act="runStart">${ic('play', 18)}Пробежка</button></div>`}
        <label class="switch mt16"><input type="checkbox" data-ch="pedoGps" ${S.pedoGps ? 'checked' : ''}><span></span>GPS: точная дистанция и распознавание транспорта</label>
        <p class="muted sm mt8">Всё работает без интернета. Когда приложение свёрнуто или экран выключен, браузер не даёт считать шаги — для подсчёта весь день используйте перенос из «Здоровья» ниже.</p>
      </section>
    </div>

    <section class="card fade mt16">
      <div class="card-h"><div><h3>${ic('chart', 18)}Последние 14 дней</h3><small class="muted">ходьба и бег</small></div></div>
      <div id="stepsChart"></div>
      <div class="legend"><span><i style="background:var(--accent)"></i>Ходьба</span><span><i style="background:var(--cf)"></i>Бег</span></div>
    </section>

    ${runs.length ? `<section class="card fade">
      <div class="card-h"><h3>${ic('flame', 18)}Пробежки сегодня</h3></div>
      <div class="list">${runs.map((r) => `<div class="li"><div class="grow"><b>${fmt(r.km, 2)} км · ${r.min} мин</b><small class="muted">${new Date(r.start).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} · темп ${paceStr(r.min / Math.max(r.km, 0.01))} мин/км · ${fmt(r.steps)} шагов${r.gps ? ' · GPS' : ''}</small></div><button class="icon-btn" data-act="runDel" data-id="${r.id}" data-date="${date}" aria-label="Удалить">${ic('x', 16)}</button></div>`).join('')}</div>
    </section>` : ''}

    ${healthSyncHTML(ios)}
    <section class="card fade">
      <div class="card-h"><div><h3>${ic('copy', 18)}Вставить шаги вручную</h3><small class="muted">${ios ? 'если автосинхронизация не настроена' : 'Google Fit, Samsung Health, часы'}</small></div></div>
      <p class="muted">Скопируйте число шагов из приложения шагов и нажмите «Вставить шаги» — FORMA прочитает его из буфера обмена.</p>
      <div class="row gap8 mt12 wrap"><button class="btn" data-act="stepsPaste">${ic('copy', 18)}Вставить шаги</button></div>
    </section>`;
  },
  mount() {
    const days = []; for (let i = 13; i >= 0; i--) days.push(addDays(todayISO(), -i));
    const parts = days.map((d) => dayStepParts(getDay(d)));
    Charts.mount($('#stepsChart'), (el) => Charts.bars(el, {
      labels: days.map((d) => String(parseISO(d).getDate())), tipLabels: days.map((d) => fmtDate(d, { full: true })), unit: 'шагов', target: targets().steps, height: 200,
      stacks: [{ name: 'Ходьба', color: 'var(--accent)', values: parts.map((p) => p.walk) }, { name: 'Бег', color: 'var(--cf)', values: parts.map((p) => p.run) }],
      empty: 'Шагов пока нет — включите шагомер или вставьте шаги из «Здоровья»',
    }));
    Pedo.ui();
  },
};
