/* ============================================================
   FORMA — дисциплина: оценка дня 0–100, серия, заморозка,
   вечерняя проверка (её нельзя просто закрыть) и недельный отчёт.
   Правила:
   • 70+ баллов — день засчитан, серия +1.
   • Пустой дневник или «Сорвал день» — серия сгорает.
   • Записанный, но недобранный день — сгорает тоже, если за последние 7 дней
     уже была заморозка. Одна заморозка в неделю спасает серию (но не прибавляет).
   ============================================================ */
'use strict';

const DISC_PASS = 70;
const Discipline = {
  shownAt: 0,
  opts() { const s = settings().disc || {}; return { on: s.on !== false, hour: +s.hour || 21 }; },
  /* Отсчёт с момента включения режима: прошлые дни до него не наказываются */
  start() {
    // Первый день считается, только если начал до полудня. Зашёл вечером — отсчёт с завтрашнего дня,
    // чтобы не «сжигать» серию за день, который ты не успел прожить с приложением.
    const firstDay = (ts) => { const d = new Date(ts); return d.getHours() < 12 ? isoOf(d) : addDays(isoOf(d), 1); };
    const s = settings().disc || {};
    if (!s.since && D.profile) { const since = firstDay(Date.now()); D.profile.settings = Object.assign(settings(), { disc: Object.assign({}, s, { since }) }); persist('profile'); return since; }
    const c = D.profile && D.profile.created ? firstDay(D.profile.created) : todayISO();
    const createdDate = D.profile && D.profile.created ? isoOf(new Date(D.profile.created)) : null;
    const since = s.since === createdDate ? c : s.since; // старые профили: «since» поставлен в день регистрации
    return since && since > c ? since : c;
  },

  corridor(goal) {
    if (goal === 'lean' || goal === 'gain') return [0.95, 1.10];
    if (goal === 'cut' || goal === 'lose' || goal === 'recomp') return [0.85, 1.03];
    return [0.92, 1.08];
  },

  /* Оценка одного дня */
  evalDay(date) {
    const raw = D.days[date]; const day = getDay(date); const t = dayTotals(day); const T = targets();
    const budget = dayBudget(date); const goal = (D.profile && D.profile.goal) || 'maintain';
    const meals = MEALS.filter((m) => (day.meals[m.id] || []).length).length;
    const [lo, hi] = this.corridor(goal);
    const ratio = budget > 0 ? t.kcal / budget : 0;
    const dist = t.kcal <= 0 ? 1 : ratio < lo ? lo - ratio : ratio > hi ? ratio - hi : 0;
    const steps = day.steps || 0; const pRatio = T.p ? t.p / T.p : 0; const wRatio = T.water ? dayWater(day) / T.water : 0;
    const parts = {
      log: meals >= 2 ? 1 : meals === 1 ? 0.4 : 0,
      kcal: t.kcal <= 0 ? 0 : clamp(1 - dist / 0.15, 0, 1),
      protein: clamp(pRatio / 0.9, 0, 1),
      steps: T.steps ? clamp(steps / T.steps, 0, 1) : 1,
      water: clamp(wRatio / 0.9, 0, 1),
    };
    const W = { log: 20, kcal: 30, protein: 20, steps: 20, water: 10 };
    const score = Math.round(Object.keys(W).reduce((s, k) => s + W[k] * parts[k], 0));
    const closed = raw && raw.closed;
    return { date, score, parts, meals, kcal: t.kcal, budget, ratio, lo, hi, p: t.p, steps, water: dayWater(day), T, closed, empty: !raw || (meals === 0 && !raw.steps),
      ok: closed !== 'failed' && score >= DISC_PASS };
  },

  /* Серия на дату (включительно, если день засчитан) */
  streak(end = todayISO()) {
    const created = this.start();
    const today = this.evalDay(end); let n = 0; const freezes = []; let lastFreeze = null; let brokeAt = null; let brokeWhy = '';
    let cur = addDays(end, -1);
    for (let i = 0; i < 730 && cur >= created; i++) {
      const e = this.evalDay(cur);
      if (e.ok) n++;
      else if (e.closed !== 'failed' && e.meals > 0 && (lastFreeze == null || dayDiff(cur, lastFreeze) >= 7)) { lastFreeze = cur; freezes.push(cur); }
      else { brokeAt = cur; brokeWhy = e.closed === 'failed' ? 'сорван' : e.meals === 0 ? 'пустой дневник' : `${e.score} из 100`; break; }
      cur = addDays(cur, -1);
    }
    if (today.ok) n++;
    return { n, freezes, today, brokeAt, brokeWhy };
  },
  best() {
    if (!D.profile || !D.profile.created) return 0;
    let cur = this.start(); const end = todayISO(); let run = 0; let best = 0; let lastFreeze = null;
    for (let i = 0; i < 730 && cur <= end; i++) {
      const e = this.evalDay(cur);
      if (e.ok) { run++; best = Math.max(best, run); }
      else if (cur !== end) {
        if (e.closed !== 'failed' && e.meals > 0 && (lastFreeze == null || dayDiff(lastFreeze, cur) >= 7)) lastFreeze = cur;
        else { run = 0; }
      }
      cur = addDays(cur, 1);
    }
    return best;
  },
  freezeReady() {
    const s = this.streak(); const last = s.freezes[0];
    return !last || dayDiff(todayISO(), last) >= 7 ? { ok: true } : { ok: false, next: addDays(last, 7) };
  },

  /* Задания на сегодня — коротко и прямо */
  tasks(e) {
    const T = e.T; const out = [];
    const early = (new Date().getHours() < 12 && e.date === todayISO()) || e.date < this.start();
    out.push({ done: e.meals >= 2, txt: e.meals >= 2 ? `Дневник: записано ${e.meals} приёма` : e.meals === 1 ? 'Дневник: один приём. Записывай всё, что ешь.' : early ? 'Дневник: запиши завтрак, когда поешь.' : 'Дневник пуст. Без записей день не засчитают.', act: 'diary' });
    const left = Math.round(e.budget - e.kcal);
    let kt; let kd = false;
    if (e.kcal <= 0) kt = `Калории: 0 из ${fmt(e.budget)}`;
    else if (e.ratio > e.hi) kt = `Калории: перебор на ${fmt(-left)} ккал. На сегодня с едой всё.`;
    else if (e.ratio < e.lo) kt = `Калории: ${fmt(e.kcal)} из ${fmt(e.budget)} — до нормы ${fmt(left)} ккал`;
    else { kt = `Калории в норме: ${fmt(e.kcal)} из ${fmt(e.budget)}`; kd = true; }
    out.push({ done: kd, txt: kt, act: 'diary' });
    const pl = Math.round(T.p * 0.9 - e.p);
    out.push({ done: pl <= 0, txt: pl <= 0 ? `Белок: ${fmt(e.p)} г — есть` : `Белок: ${fmt(e.p)} из ${fmt(T.p)} г — добери ещё ${fmt(pl)} г`, act: 'diary' });
    const sl = T.steps - e.steps;
    out.push({ done: sl <= 0, txt: sl <= 0 ? `Шаги: ${fmt(e.steps)} — цель выполнена` : `Шаги: ${fmt(e.steps)} из ${fmt(T.steps)} — ещё ${fmt(sl)} (≈ ${fmt(Math.ceil(sl / 100))} мин ходьбы)`, act: 'steps' });
    const wl = Math.round(T.water * 0.9 - e.water);
    out.push({ done: wl <= 0, txt: wl <= 0 ? 'Вода: норма выпита' : `Вода: ${fmt(e.water)} из ${fmt(T.water)} мл`, act: 'dashboard' });
    return out;
  },

  weekly() {
    const days = []; for (let i = 7; i >= 1; i--) days.push(addDays(todayISO(), -i));
    const created = this.start();
    const ev = days.map((d) => (d < created ? null : this.evalDay(d)));
    const real = ev.filter(Boolean);
    if (!real.length) return null;
    const avg = Math.round(real.reduce((s, e) => s + (e.closed === 'failed' ? Math.min(e.score, 40) : e.score), 0) / real.length);
    const passed = real.filter((e) => e.ok).length;
    const names = { log: 'дневник', kcal: 'калории', protein: 'белок', steps: 'шаги', water: 'вода' };
    const means = Object.fromEntries(Object.keys(names).map((k) => [k, real.reduce((s, e) => s + e.parts[k], 0) / real.length]));
    const worst = Object.entries(means).sort((a, b) => a[1] - b[1])[0];
    const grade = avg >= 90 ? 5 : avg >= 75 ? 4 : avg >= 60 ? 3 : 2;
    const verdict = {
      5: 'Железная неделя. Так и держать.',
      4: `Хорошо, но слабое место — ${names[worst[0]]}. Подтяни на этой неделе.`,
      3: `Средне. ${names[worst[0]][0].toUpperCase() + names[worst[0]].slice(1)} тянет вниз — это первое, что исправить.`,
      2: 'Слабая неделя. Начни с простого: записывай всю еду каждый день, остальное подтянется.',
    }[grade];
    return { days, ev, avg, passed, total: real.length, means, names, grade, verdict };
  },

  /* ---------- Карточка на главной ---------- */
  cardHTML() {
    if (!D.profile || !this.opts().on) return '';
    const s = this.streak(); const e = s.today; const tasks = this.tasks(e); const todo = tasks.filter((t) => !t.done).slice(0, 2);
    const y = this.evalDay(addDays(todayISO(), -1));
    const burned = s.brokeAt === addDays(todayISO(), -1) && this.streak(addDays(todayISO(), -2)).n > 0;
    return `<section class="card disc-card fade">
      <div class="card-h"><h3>${ic('flame', 18)}Дисциплина</h3><a href="#discipline" class="link">Отчёт</a></div>
      <div class="disc-top">
        <a href="#discipline" class="flame-box ${e.ok ? 'lit' : s.n ? 'wait' : 'off'}">${flameSVG(64, e.ok ? 'lit' : s.n ? 'wait' : 'off')}<b>${s.n}</b><span>${plural(s.n, 'день', 'дня', 'дней')}</span></a>
        <div class="grow"><div class="row between"><span class="muted sm">Сегодня</span><b class="${e.score >= DISC_PASS ? 'ok-t' : ''}">${e.score}<small class="muted"> / 100</small></b></div>
          <div class="pbar disc-bar"><i style="width:${e.score}%;background:${e.score >= DISC_PASS ? 'var(--ok)' : 'var(--accent)'}"></i><em style="left:${DISC_PASS}%"></em></div>
          <small class="muted">${e.score >= DISC_PASS ? 'День засчитан. Не расслабляйся до вечера.' : `До зачёта ${DISC_PASS - e.score} ${plural(DISC_PASS - e.score, 'балл', 'балла', 'баллов')}`}</small></div>
      </div>
      <p class="flame-msg mt12">${esc(Discipline.message(s))}</p>
      ${burned ? `<div class="banner err mt12">${ic('info', 18)}<div>Вчера серия сгорела: ${esc(s.brokeWhy)}. Сегодня — с нуля.</div></div>` : (!y.ok && y.meals > 0 && s.freezes[0] === addDays(todayISO(), -1) ? `<div class="banner warn mt12">${ic('info', 18)}<div>Вчера не дотянул (${y.score}/100) — серию спасла заморозка. Следующая будет только через неделю.</div></div>` : '')}
      ${todo.length ? `<ul class="disc-tasks mt12">${todo.map((t) => `<li><a href="#${t.act}">${ic('right', 16)}${esc(t.txt)}</a></li>`).join('')}</ul>` : '<p class="muted sm mt12">Все задачи на сегодня выполнены.</p>'}
    </section>`;
  },

  /* Поддержка — только по реальным цифрам */
  message(s) {
    const n = s.n; const e = s.today; const best = this.best();
    const M = { 3: '3 дня подряд — привычка начинает складываться.', 7: 'Неделя без срывов. Это уже не случайность.', 14: 'Две недели подряд. Так держат единицы.', 21: '21 день — режим стал частью тебя.', 30: 'Месяц без срывов. Серьёзно, это уровень.', 50: '50 дней. Ты доказал себе, что можешь.', 100: '100 дней подряд. Легенда.', 150: '150 дней. Дисциплина стала характером.', 200: '200 дней подряд.', 365: 'Год без срывов.' };
    const yBurn = s.brokeAt === addDays(todayISO(), -1) && this.streak(addDays(todayISO(), -2)).n > 0;
    if (e.ok) {
      if (M[n]) return M[n];
      if (n > 1 && n >= best) return `Новый рекорд — ${n} ${plural(n, 'день', 'дня', 'дней')}. Дальше только выше.`;
      if (n === 1) return 'Огонёк зажжён. Первый день — самый важный. Завтра повтори.';
      return `Огонёк горит ${n} ${plural(n, 'день', 'дня', 'дней')}. Ты держишь слово — продолжай.`;
    }
    const left = DISC_PASS - e.score; const task = this.tasks(e).find((t) => !t.done);
    const hour = new Date().getHours(); const hrs = 24 - hour;
    if (todayISO() < this.start()) return 'Отсчёт серии начнётся завтра. Сегодня осваивайся: попробуй записать еду и воду.';
    if (hour < 12 && !yBurn) return n ? `Доброе утро! Серия ${n} ${plural(n, 'день', 'дня', 'дней')}. День только начался — запиши завтрак, и вперёд.` : 'Доброе утро! День только начался: записывай еду, пей воду, ходи — и к вечеру огонёк загорится.';
    if (n === 0) return yBurn ? `Серия сгорела (${s.brokeWhy}). Бывает. Новый огонёк можно зажечь уже сегодня: нужно ещё ${left} ${plural(left, 'балл', 'балла', 'баллов')}.` : `Огонька пока нет. Сегодня — день первый: набери ещё ${left} ${plural(left, 'балл', 'балла', 'баллов')}.`;
    const tail = task ? ' ' + task.txt.replace(/[.s]+$/, '') + '.' : '';
    if (hrs <= 3) return `До полуночи ${hrs} ч. Не дай серии из ${n} ${plural(n, 'дня', 'дней', 'дней')} сгореть — осталось ${left} ${plural(left, 'балл', 'балла', 'баллов')}.${tail}`;
    return `Серия из ${n} ${plural(n, 'дня', 'дней', 'дней')} ждёт: ещё ${left} ${plural(left, 'балл', 'балла', 'баллов')} до зачёта.${tail}`;
  },
  /* Праздник, когда день впервые засчитан */
  celebrate() {
    if (!booted || !D.profile || !this.opts().on || Sheet.stack.length) return;
    const t = todayISO(); const raw = D.days[t]; if (!raw || raw.lit) return;
    const s = this.streak(); if (!s.today.ok) return;
    raw.lit = true; saveDay(t);
    try { if (navigator.vibrate) navigator.vibrate([40, 60, 40]); } catch (e) { /* нет вибро */ }
    Sheet.open({ title: '', body: `<div class="celebrate">${flameSVG(140, 'lit')}<b>${s.n}</b><span>${plural(s.n, 'день', 'дня', 'дней')} подряд</span><p class="lead">${esc(this.message(s))}</p><button class="btn primary block mt16" data-act="sheetClose">Так держать</button></div>` });
  },
  badge() {
    const el = document.getElementById('streakTop'); const el2 = document.getElementById('streakSide');
    if (!D.profile || !this.opts().on) { [el, el2].forEach((x) => x && (x.hidden = true)); return; }
    const s = this.streak(); const st = s.today.ok ? 'lit' : s.n ? 'wait' : 'off';
    const html = `${flameSVG(20, st)}<b>${s.n}</b>`;
    [el, el2].forEach((x) => { if (x) { x.hidden = false; x.className = 'streak-badge ' + st; x.innerHTML = html; x.title = s.today.ok ? 'Сегодня засчитан' : 'Сегодня ещё не засчитан'; } });
  },

  /* ---------- Вечерняя проверка ---------- */
  eveningCheck(force) {
    if (!booted || !D.profile) return;
    const o = this.opts(); if (!o.on) return;
    const now = new Date(); if (!force && now.getHours() < o.hour) return;
    if (!force && todayISO() < this.start()) return; // в день регистрации вечером не проверяем
    const today = todayISO(); const raw = D.days[today]; if (raw && raw.closed) return;
    if (!force && (Sheet.stack.length || Date.now() - this.shownAt < 15 * 60000)) return;
    this.shownAt = Date.now();
    const e = this.evalDay(today); const s = this.streak(); const tasks = this.tasks(e); const pass = e.score >= DISC_PASS;
    Reminders.fire(pass ? 'Закрой день — он засчитан.' : `Итог дня: ${e.score}/100. До зачёта не хватает ${DISC_PASS - e.score}.`, 'disc' + today);
    Sheet.open({ title: 'Итог дня', locked: true, body: `
      <div class="disc-sum ${pass ? 'pass' : 'fail'}"><b>${e.score}</b><span>из 100 · зачёт от ${DISC_PASS}</span></div>
      <ul class="disc-list">${tasks.map((t) => `<li class="${t.done ? 'done' : ''}">${ic(t.done ? 'check' : 'x', 16)}<span>${esc(t.txt)}</span></li>`).join('')}</ul>
      <p class="lead mt12">${pass ? `День засчитан. Серия станет ${s.n} ${plural(s.n, 'день', 'дня', 'дней')}.` : e.meals === 0 ? 'Дневник пуст. Запиши еду или признай, что день сорван.' : `Не хватает ${DISC_PASS - e.score} ${plural(DISC_PASS - e.score, 'балла', 'баллов', 'баллов')}. Ещё есть время добить.`}</p>
      <div class="disc-actions">
        ${pass ? '<button class="btn primary block" data-act="discClose" data-v="ok">Закрыть день</button>'
          : `<button class="btn primary block" data-act="discFix">Добить день</button><button class="btn danger block" data-act="discClose" data-v="failed">Сорвал день — признаю</button>`}
      </div>` });
  },
};
let _flameN = 0;
function flameSVG(size, state = 'lit') {
  const id = 'fl' + (++_flameN);
  const stops = state === 'lit' ? ['#ffd43b', '#ff922b', '#f03e3e'] : ['#b8b8b2', '#8f8f8a', '#6e6e69'];
  return `<svg class="flame ${state}" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${stops[2]}"/><stop offset=".55" stop-color="${stops[1]}"/><stop offset="1" stop-color="${stops[0]}"/></linearGradient></defs>
    <path class="fl-out" d="M32 4c3 9 14 15 14 30a14 14 0 0 1-28 0c0-7 3-11 6-14 0 5 2 8 5 9-2-9 1-18 3-25Z" fill="url(#${id})"/>
    <path class="fl-in" d="M32 30c2 4 7 7 7 13a7 7 0 0 1-14 0c0-4 2-6 4-8 0 2 1 4 3 4-1-3-1-6 0-9Z" fill="${state === 'lit' ? '#fff3bf' : '#d9d9d4'}" opacity=".9"/></svg>`;
}
function dayDiff(a, b) { return Math.round((parseISO(a) - parseISO(b)) / 86400000); }

ACT.discClose = (el) => {
  const d = ensureDay(todayISO()); d.closed = el.dataset.v; saveDay(todayISO()); Sheet.close(); render();
  if (el.dataset.v === 'failed') toast('Серия обнулена. Завтра — с нуля. Без оправданий.', 'warn', 5000);
  else toast(`День закрыт. Серия: ${Discipline.streak().n}`, 'ok', 4000);
};
ACT.discFix = () => {
  const e = Discipline.evalDay(todayISO()); const worst = Discipline.tasks(e).find((t) => !t.done);
  Discipline.shownAt = Date.now(); Sheet.close(); go(worst ? worst.act : 'diary');
  toast('Через 15 минут спрошу снова.', 'ok', 3500);
};
ACT.discCheckNow = () => Discipline.eveningCheck(true);
ACT.discToggle = (el) => { const s = settings().disc || {}; setSetting('disc', Object.assign({}, s, { on: el.checked })); render(); };
ACT.discHour = (el) => { const s = settings().disc || {}; setSetting('disc', Object.assign({}, s, { hour: +el.value })); toast(`Вечерняя проверка в ${el.value}:00`); };
ACT.discReopen = () => { const d = D.days[todayISO()]; if (d) { delete d.closed; saveDay(todayISO()); } render(); };

setInterval(() => Discipline.eveningCheck(), 30000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(() => Discipline.eveningCheck(), 800); });

/* ---------- Страница «Дисциплина» ---------- */
PAGES.discipline = {
  title: 'Дисциплина', icon: 'flame',
  render() {
    if (!this.ok()) return '';
    const o = Discipline.opts(); const s = Discipline.streak(); const e = s.today; const best = Math.max(Discipline.best(), s.n);
    const fr = Discipline.freezeReady(); const W = Discipline.weekly(); const tasks = Discipline.tasks(e); const closed = D.days[todayISO()] && D.days[todayISO()].closed;
    return `
    <div class="pagehead"><div><h1>Дисциплина</h1><p class="muted">Каждый день — оценка от 0 до 100. ${DISC_PASS}+ — день засчитан. Пустой дневник сжигает серию.</p></div></div>
    <div class="grid g2">
      <section class="card fade">
        <div class="card-h"><h3>${ic('flame', 18)}Серия</h3><span class="muted sm">рекорд ${best}</span></div>
        <div class="disc-big ${s.n ? 'on' : ''}">${flameSVG(84, e.ok ? 'lit' : s.n ? 'wait' : 'off')}<div><b>${s.n}</b><span>${plural(s.n, 'день', 'дня', 'дней')} подряд</span></div></div>
        <p class="flame-msg mt12">${esc(Discipline.message(s))}</p>
        <p class="muted sm mt12">${fr.ok ? 'Заморозка доступна: один недобранный (но записанный) день серию не сожжёт.' : `Заморозка использована. Следующая — с ${fmtDate(fr.next, { full: true })}.`}</p>
        ${s.brokeAt ? `<p class="muted sm">Прошлый срыв: ${fmtDate(s.brokeAt, { full: true })} — ${esc(s.brokeWhy)}.</p>` : ''}
      </section>
      <section class="card fade">
        <div class="card-h"><h3>${ic('check', 18)}Сегодня</h3><b>${e.score}<small class="muted"> / 100</small></b></div>
        <div class="pbar disc-bar"><i style="width:${e.score}%;background:${e.score >= DISC_PASS ? 'var(--ok)' : 'var(--accent)'}"></i><em style="left:${DISC_PASS}%"></em></div>
        <ul class="disc-list mt12">${tasks.map((t) => `<li class="${t.done ? 'done' : ''}">${ic(t.done ? 'check' : 'x', 16)}<a href="#${t.act}">${esc(t.txt)}</a></li>`).join('')}</ul>
        ${closed ? `<p class="muted sm mt12">День закрыт: ${closed === 'ok' ? 'засчитан' : 'сорван'}. <button class="link inline-link" data-act="discReopen">Открыть заново</button></p>` : `<button class="btn block mt12" data-act="discCheckNow">Подвести итог дня сейчас</button>`}
      </section>
    </div>

    <section class="card fade mt16">
      <div class="card-h"><div><h3>${ic('chart', 18)}Отчёт за неделю</h3><small class="muted">последние 7 дней без сегодняшнего</small></div>${W ? `<div class="grade g${W.grade}">${W.grade}</div>` : ''}</div>
      ${W ? `<p class="lead">${esc(W.verdict)}</p>
        <p class="muted sm">Средний балл ${W.avg} · засчитано ${W.passed} из ${W.total} ${plural(W.total, 'дня', 'дней', 'дней')}</p>
        <div id="discChart" class="mt12"></div>
        <div class="disc-means mt12">${Object.entries(W.names).map(([k, n]) => `<div><span>${n}</span><div class="pbar"><i style="width:${Math.round(W.means[k] * 100)}%;background:${W.means[k] >= 0.8 ? 'var(--ok)' : W.means[k] >= 0.5 ? 'var(--warn)' : 'var(--over)'}"></i></div><b>${Math.round(W.means[k] * 100)}%</b></div>`).join('')}</div>`
        : '<p class="muted">Отчёт появится после первого полного дня.</p>'}
    </section>

    <section class="card fade">
      <div class="card-h"><h3>${ic('gear', 18)}Правила и настройки</h3></div>
      <ul class="steps-list"><li>Баллы: дневник 20 · калории в коридоре цели 30 · белок 20 · шаги 20 · вода 10.</li>
        <li>Коридор калорий: на сушке и похудении — не больше нормы +3%, на наборе — не меньше −5%.</li>
        <li>Пустой дневник или «Сорвал день» — серия сгорает сразу.</li>
        <li>Одна заморозка в 7 дней спасает недобранный, но честно записанный день.</li>
        <li>Вечером приходит итог дня. Его нельзя смахнуть — только закрыть день, добить его или признать срыв.</li></ul>
      <label class="switch mt16"><input type="checkbox" data-ch="discToggle" ${o.on ? 'checked' : ''}><span></span>Режим дисциплины</label>
      <label class="form mt12">Вечерняя проверка<select class="input" data-ch="discHour">${[19, 20, 21, 22, 23].map((h) => `<option value="${h}" ${o.hour === h ? 'selected' : ''}>${h}:00</option>`).join('')}</select></label>
    </section>`;
  },
  ok() { return !!D.profile; },
  mount() {
    const W = Discipline.weekly(); if (!W || !$('#discChart')) return;
    Charts.mount($('#discChart'), (el) => Charts.bars(el, {
      labels: W.days.map((d) => WD[parseISO(d).getDay()]), tipLabels: W.days.map((d) => fmtDate(d, { full: true })),
      values: W.ev.map((x) => (x ? Math.max(x.score, 1) : 0)), colors: W.ev.map((x) => (!x ? 'var(--track)' : x.ok ? 'var(--ok)' : 'var(--over)')),
      target: DISC_PASS, unit: 'баллов', height: 170,
    }));
  },
};
