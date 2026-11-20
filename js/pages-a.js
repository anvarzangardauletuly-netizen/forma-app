/* ============================================================
   FORMA — страницы: Главная, Дневник питания, База продуктов
   ============================================================ */
'use strict';

const App = { page: 'dashboard', diaryDate: todayISO(), statsRange: 30, weightRange: 30, foodCat: 'all', foodQ: '', foodLimit: 80, woTab: 'programs', calMonth: null, plannerTab: 'week', planDay: 1 };
const PAGES = {};

const macroLine = (n) => `<span class="mac"><i class="dp"></i>Б ${fmt(n.p, 1)}</span><span class="mac"><i class="df"></i>Ж ${fmt(n.f, 1)}</span><span class="mac"><i class="dc"></i>У ${fmt(n.c, 1)}</span>`;
const emptyState = (icon, title, text, btn = '') => `<div class="empty">${ic(icon, 28)}<b>${title}</b><p>${text}</p>${btn}</div>`;

/* ============================================================
   ГЛАВНАЯ
   ============================================================ */
PAGES.dashboard = {
  title: 'Главная', icon: 'home',
  render() {
    const date = todayISO(); const day = getDay(date); const t = dayTotals(day); const T = targets();
    const budget = dayBudget(date); const burned = dayBurned(date); const left = budget - t.kcal;
    const name = (D.profile && D.profile.name) || '';
    const h = new Date().getHours(); const hi = h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер';
    const weights = [...D.weights.entries].sort((a, b) => (a.date < b.date ? -1 : 1));
    const lastW = weights[weights.length - 1];
    const w30 = weights.filter((e) => e.date >= addDays(date, -30));
    const wDelta = w30.length > 1 ? w30[w30.length - 1].kg - w30[0].kg : null;
    const recentWo = Object.values(D.workouts).sort((a, b) => (a.date + a.end < b.date + b.end ? 1 : -1)).slice(0, 3);
    const stepsOn = day.steps != null;
    const glasses = Math.ceil(T.water / 250);
    const recs = recommendations();

    return `
    <div class="hello"><div><h1>${hi}${name ? ', ' + esc(name) : ''}</h1><p class="muted">${WD_FULL[new Date().getDay()]}, ${fmtDate(date, { full: true })}</p></div>
      <button class="btn primary hide-sm" data-act="pick" data-meal="${autoMeal()}" data-date="${date}">${ic('plus', 18)}Добавить еду</button></div>
    ${PWA.bannerHTML()}
    ${premiumNudgeHTML()}

    <section class="card hero fade">
      <div class="hero-main">
        ${Charts.ring({ value: t.kcal, max: budget, size: 184, stroke: 14, label: fmt(Math.abs(left)), sub: left >= 0 ? 'ккал осталось' : 'ккал сверх нормы', over: left < 0 })}
        <div class="hero-stats">
          <div><span class="muted">Съедено</span><b>${fmt(t.kcal)}</b><small>ккал</small></div>
          <div><span class="muted">Норма</span><b>${fmt(budget)}</b><small>ккал${budget !== T.kcal ? ' (+ активность)' : ''}</small></div>
          <div><span class="muted">Сожжено</span><b>${fmt(burned.total)}</b><small>ккал ≈</small></div>
        </div>
      </div>
      <div class="hero-macros">
        ${[['p', 'Белки', 'var(--cp)'], ['f', 'Жиры', 'var(--cf)'], ['c', 'Углеводы', 'var(--cc)']].map(([k, n, col]) => `
          <div class="macro">${Charts.ring({ value: t[k], max: T[k], size: 76, stroke: 7, color: col, label: fmt(t[k]), sub: 'из ' + fmt(T[k]) })}<span>${n}</span></div>`).join('')}
        <div class="macro">${Charts.ring({ value: t.fib, max: T.fib, size: 76, stroke: 7, color: 'var(--muted)', label: fmt(t.fib), sub: 'из ' + fmt(T.fib) })}<span>Клетчатка</span></div>
      </div>
    </section>

    ${Discipline.cardHTML()}

    <div class="grid g3">
      <section class="card fade">
        <div class="card-h"><h3>${ic('fork', 18)}Приёмы пищи</h3><a href="#diary" class="link">Дневник</a></div>
        <div class="meal-rows">${MEALS.map((m) => {
          const mt = mealTotals(day, m.id); const cnt = (day.meals[m.id] || []).length;
          return `<div class="meal-row"><span class="chk ${cnt ? 'on' : ''}">${cnt ? ic('check', 14) : ''}</span>
            <div class="grow"><b>${m.name}</b><small class="muted">${cnt ? `${cnt} ${plural(cnt, 'продукт', 'продукта', 'продуктов')} · ${fmt(mt.kcal)} ккал` : 'ещё не добавлено'}</small></div>
            <button class="icon-btn soft" data-act="pick" data-meal="${m.id}" data-date="${date}" aria-label="Добавить в ${m.name}">${ic('plus', 18)}</button></div>`;
        }).join('')}</div>
      </section>

      <section class="card fade">
        <div class="card-h"><h3>${ic('drop', 18)}Вода</h3><span class="muted">${fmt(dayWater(day))} / ${fmt(T.water)} мл</span></div>
        <div class="glasses">${Array.from({ length: Math.min(glasses, 12) }, (_, i) => `<span class="glass ${dayWater(day) >= (i + 1) * 250 ? 'on' : ''}"></span>`).join('')}</div>
        ${Charts.bar(dayWater(day), T.water, 'var(--cw)', true)}
        <div class="row gap8 mt12"><button class="btn sm" data-act="water" data-v="250">+250 мл</button><button class="btn sm" data-act="water" data-v="500">+500</button><button class="btn sm ghost" data-act="water" data-v="-250">−250</button><button class="btn sm ghost" data-act="waterCustom">Своё</button></div>
      </section>

      <section class="card fade">
        <div class="card-h"><h3>${ic('steps', 18)}Шаги</h3><a href="#steps" class="link">${Pedo.on ? '● идёт подсчёт' : 'Подробнее'}</a></div>
        ${stepsOn ? stepsSummaryHTML(day, T, burned)
          : `<p class="muted">Сегодня шагов пока нет. Впишите их вручную, включите шагомер или перенесите из «Здоровья». Цель — ${fmt(T.steps)} в день.</p>`}
        <div class="row gap8 mt12 wrap"><button class="btn sm primary" data-act="stepsEdit">${stepsOn ? 'Изменить шаги' : 'Ввести шаги'}</button><button class="btn sm" data-act="pedometer">${Pedo.on ? 'Остановить' : 'Шагомер'}</button><button class="btn sm ghost" data-act="stepsGoalEdit">Цель</button>${healthRefreshBtn('btn sm')}</div>
      </section>

      <section class="card fade">
        <div class="card-h"><h3>${ic('flame', 18)}Активность</h3><button class="icon-btn soft" data-act="activityAdd" data-date="${date}" aria-label="Добавить активность">${ic('plus', 18)}</button></div>
        ${(day.activities || []).length || workoutsOn(date).length ? `<div class="list">${(day.activities || []).map((a) => `<div class="li"><div class="grow"><b>${esc(a.name)}</b><small class="muted">${a.min} мин</small></div><span>${fmt(a.kcal)} ккал</span><button class="icon-btn" data-act="activityDel" data-id="${a.id}" data-date="${date}" aria-label="Удалить">${ic('x', 16)}</button></div>`).join('')}
          ${workoutsOn(date).map((w) => `<div class="li"><div class="grow"><b>${esc(w.name)}</b><small class="muted">тренировка · ${w.durationMin} мин</small></div><span>${fmt(workoutKcal(w))} ккал</span></div>`).join('')}</div>`
          : `<p class="muted">Пока ничего. Добавьте прогулку, спорт или проведите тренировку.</p>`}
        <p class="muted sm mt8">Итого ≈ ${fmt(burned.total)} ккал (оценка по MET).</p>
      </section>

      <section class="card fade">
        <div class="card-h"><h3>${ic('scale', 18)}Вес</h3><a href="#weight" class="link">История</a></div>
        ${lastW ? `<div class="row between end"><div class="bignum">${fmt(lastW.kg, 1)}<small> кг</small></div>${Charts.spark(weights.slice(-20).map((e) => e.kg), 'var(--accent-ink)')}</div>
          <p class="muted sm">${wDelta != null ? `За 30 дней: <b>${wDelta > 0 ? '+' : ''}${fmt(wDelta, 1)} кг</b>` : 'Добавьте ещё измерения для динамики'} · ${fmtDate(lastW.date)}</p>`
          : `<p class="muted">Нет записей веса.</p>`}
        <button class="btn sm mt12" data-act="weightAdd">${ic('plus', 16)}Записать вес</button>
      </section>

      <section class="card fade">
        <div class="card-h"><h3>${ic('dumbbell', 18)}Тренировки</h3><a href="#workouts" class="link">Все</a></div>
        ${D.active ? `<div class="banner">Идёт тренировка: <b>${esc(D.active.name)}</b><button class="btn sm primary" data-act="woOpen">Продолжить</button></div>` : ''}
        ${recentWo.length ? `<div class="list">${recentWo.map((w) => `<div class="li"><div class="grow"><b>${esc(w.name)}</b><small class="muted">${fmtDate(w.date)} · ${w.durationMin} мин · ${w.exercises.length} упр.</small></div><span class="muted">${fmt(woVolume(w))} кг</span></div>`).join('')}</div>`
          : `<p class="muted">Тренировок пока нет.</p>`}
        ${!D.active ? `<button class="btn sm mt12" data-act="woStartPick">${ic('play', 16)}Начать тренировку</button>` : ''}
      </section>
    </div>

    <div class="grid g2">
      <section class="card fade">
        <div class="card-h"><h3>${ic('chart', 18)}Неделя</h3><a href="#stats" class="link">Аналитика</a></div>
        <div class="chart-box" id="dashWeek"></div>
        ${weekSummaryHTML()}
      </section>
      <section class="card fade">
        <div class="card-h"><h3>${ic('spark', 18)}Рекомендации</h3><a href="#ai" class="link">AI-помощник</a></div>
        ${recs.length ? `<ul class="recs">${recs.map((r) => `<li>${ic(r.icon, 18)}<span>${r.text}</span></li>`).join('')}</ul>` : '<p class="muted">Заполняйте дневник несколько дней — здесь появятся персональные подсказки.</p>'}
      </section>
    </div>`;
  },
  mount() {
    const days = rangeDays(addDays(todayISO(), -6), todayISO());
    Charts.mount($('#dashWeek'), (el) => Charts.bars(el, {
      labels: days.map((d) => WD[parseISO(d).getDay()]), tipLabels: days.map((d) => fmtDate(d)),
      values: days.map((d) => (D.days[d] && dayHasFood(D.days[d]) ? r0(dayTotals(D.days[d]).kcal) : 0)), target: targets().kcal, unit: 'ккал', height: 180,
      empty: 'Нет записей питания за неделю',
    }));
  },
};

function plural(n, a, b, c) { n = Math.abs(n) % 100; const n1 = n % 10; if (n > 10 && n < 20) return c; if (n1 > 1 && n1 < 5) return b; if (n1 === 1) return a; return c; }
function autoMeal() { const h = new Date().getHours(); return h < 11 ? 'breakfast' : h < 16 ? 'lunch' : h < 21 ? 'dinner' : 'snack'; }
function woVolume(w) { return (w.exercises || []).reduce((s, e) => s + (e.sets || []).filter((x) => x.done).reduce((a, x) => a + (+x.reps || 0) * (+x.w || 0), 0), 0); }

function weekSummaryHTML() {
  const days = rangeDays(addDays(todayISO(), -6), todayISO());
  const logged = days.filter((d) => D.days[d] && dayHasFood(D.days[d]));
  if (!logged.length) return '';
  const avg = logged.reduce((a, d) => addN(a, dayTotals(D.days[d])), zeroN()); NK.forEach((k) => { avg[k] /= logged.length; });
  const wo = Object.values(D.workouts).filter((w) => w.date >= days[0]).length;
  const water = days.reduce((s, d) => s + dayWater(D.days[d]), 0) / 7;
  return `<div class="kpis">
    <div><span class="muted">Ср. ккал</span><b>${fmt(avg.kcal)}</b></div><div><span class="muted">Ср. белок</span><b>${fmt(avg.p)} г</b></div>
    <div><span class="muted">Тренировок</span><b>${wo}</b></div><div><span class="muted">Ср. вода</span><b>${fmt(water / 1000, 1)} л</b></div></div>`;
}

/* Персональные рекомендации — детерминированные правила по фактическим данным */
function recommendations() {
  const out = []; const T = targets(); const t0 = todayISO();
  const days = rangeDays(addDays(t0, -6), addDays(t0, -1)).filter((d) => D.days[d] && dayHasFood(D.days[d]));
  if (days.length >= 3) {
    const avg = days.reduce((a, d) => addN(a, dayTotals(D.days[d])), zeroN()); NK.forEach((k) => { avg[k] /= days.length; });
    if (avg.p < T.p * 0.85) out.push({ icon: 'info', text: `Белок в среднем ${fmt(avg.p)} г при цели ${fmt(T.p)} г. Добавьте творог, яйца, курицу, рыбу или бобовые.` });
    if (avg.fib < T.fib * 0.7) out.push({ icon: 'info', text: `Клетчатки ${fmt(avg.fib)} г в день — меньше цели (${fmt(T.fib)} г). Помогут овощи, крупы, бобовые, ягоды.` });
    if (avg.kcal > T.kcal * 1.1) out.push({ icon: 'info', text: `Средняя калорийность ${fmt(avg.kcal)} ккал — выше нормы на ${fmt(avg.kcal - T.kcal)}. Посмотрите, какие приёмы пищи самые калорийные.` });
    if (avg.kcal < T.kcal * 0.75 && avg.kcal > 0) out.push({ icon: 'heart', text: `Вы едите заметно меньше нормы (≈${fmt(avg.kcal)} ккал). Сильный дефицит мешает восстановлению — проверьте, всё ли записано.` });
    if (avg.salt > 6) out.push({ icon: 'info', text: `Соли ≈${fmt(avg.salt, 1)} г в день (по записанным продуктам) — ВОЗ советует до 5 г.` });
  } else out.push({ icon: 'book', text: 'Заполните дневник хотя бы 3 дня — рекомендации станут точнее.' });
  const day = getDay(t0); const h = new Date().getHours();
  if (h >= 14 && dayWater(day) < T.water * 0.4) out.push({ icon: 'drop', text: `Сегодня выпито ${fmt(dayWater(day))} мл из ${fmt(T.water)}. Самое время для стакана воды.` });
  const lastWo = Object.values(D.workouts).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  if (lastWo && diffDays(lastWo.date, t0) >= 4) out.push({ icon: 'dumbbell', text: `Последняя тренировка была ${diffDays(lastWo.date, t0)} дн. назад.` });
  if (!D.weights.entries.some((e) => e.date >= addDays(t0, -7))) out.push({ icon: 'scale', text: 'Взвешивайтесь 1–2 раза в неделю утром, в одинаковых условиях — так динамика будет честнее.' });
  return out.slice(0, 5);
}

/* ---------- Вода, шаги, активность ---------- */
ACT.water = (el) => { const d = ensureDay(todayISO()); d.water = Math.max(0, (d.water || 0) + +el.dataset.v); saveDay(todayISO()); render(); };
ACT.waterCustom = () => {
  Sheet.open({ title: 'Добавить воду', body: `<form data-sub="waterCustomSave" class="form"><label>Объём, мл<input class="input" name="ml" inputmode="numeric" placeholder="например, 330" autofocus></label><button class="btn primary block">Добавить</button></form>` });
};
ACT.waterCustomSave = validated((f) => { const ml = readNum(f, 'ml', { min: -3000, max: 3000, label: 'Объём' }); const d = ensureDay(todayISO()); d.water = Math.max(0, d.water + ml); saveDay(todayISO()); Sheet.close(); render(); });
/* Шаги вручную — за любой день (по умолчанию сегодня; в дневнике — открытый день) */
ACT.stepsEdit = (el) => {
  const date = (el && el.dataset && el.dataset.date) || (App.page === 'diary' ? App.diaryDate : todayISO());
  const d = getDay(date); const T = targets();
  const s = Sheet.open({ title: 'Сколько шагов вы прошли', body: `<form data-sub="stepsSave" class="form">
    <label>День<input class="input" type="date" name="date" value="${date}" max="${todayISO()}"></label>
    <label>Количество шагов<input class="input big" name="steps" inputmode="numeric" value="${d.steps ?? ''}" placeholder="например, 8500" autocomplete="off"></label>
    <div class="chips" data-k="add">${[1000, 2000, 5000].map((n) => `<button type="button" class="chip" data-n="${n}">+${fmt(n)}</button>`).join('')}<button type="button" class="chip" data-n="goal">= цель (${fmt(T.steps)})</button></div>
    <p class="muted sm">Перепишите число из приложения телефона или часов. Пустое поле — «нет данных за день».</p>
    <button class="btn primary block">Сохранить</button></form>` });
  const f = s.querySelector('form'); const inp = f.steps;
  f.date.onchange = () => { const x = getDay(f.date.value || todayISO()).steps; inp.value = x ?? ''; };
  s.querySelector('[data-k=add]').onclick = (e) => { const b = e.target.closest('[data-n]'); if (!b) return; inp.value = b.dataset.n === 'goal' ? T.steps : (parseInt(inp.value.replace(/\D/g, ''), 10) || 0) + +b.dataset.n; };
  setTimeout(() => inp.focus(), 150);
};
ACT.stepsSave = validated((f) => {
  f.steps.value = f.steps.value.replace(/[\s\u00a0]/g, '');
  const v = readNum(f, 'steps', { min: 0, max: 150000, required: false, label: 'Шаги', int: true });
  const date = /^\d{4}-\d{2}-\d{2}$/.test(f.date.value) && f.date.value <= todayISO() ? f.date.value : todayISO();
  const d = ensureDay(date); d.steps = v; d.stepsSrc = v == null ? null : 'manual';
  if (v == null || (d.stepsRun || 0) > v) { d.stepsRun = v == null ? 0 : Math.min(d.stepsRun || 0, v); d.kmRun = null; }
  saveDay(date); Sheet.close(); render(); toast(v == null ? 'Шаги за день очищены' : `Шаги за ${fmtDate(date).toLowerCase()}: ${fmt(v)}`);
});
/* Своя цель по шагам */
ACT.stepsGoalEdit = () => {
  const T = targets();
  const s = Sheet.open({ title: 'Цель: шагов в день', body: `<form data-sub="stepsGoalSave" class="form">
    <label>Сколько шагов в день хотите проходить<input class="input big" name="goal" inputmode="numeric" value="${T.steps}" autocomplete="off"></label>
    <div class="chips" data-k="pre">${[5000, 6000, 8000, 10000, 12000, 15000].map((n) => `<button type="button" class="chip ${n === T.steps ? 'on' : ''}" data-n="${n}">${fmt(n)}</button>`).join('')}</div>
    <p class="muted sm">Ориентир ВОЗ для взрослых — 7–10 тысяч шагов в день. Начните с реальной цели и повышайте постепенно.</p>
    <button class="btn primary block">Сохранить цель</button></form>` });
  s.querySelector('[data-k=pre]').onclick = (e) => { const b = e.target.closest('[data-n]'); if (!b) return; s.querySelector('[name=goal]').value = b.dataset.n; s.querySelectorAll('[data-k=pre] .chip').forEach((c) => c.classList.toggle('on', c === b)); };
};
ACT.stepsGoalSave = validated((f) => {
  f.goal.value = f.goal.value.replace(/[\s\u00a0]/g, '');
  const v = readNum(f, 'goal', { min: 500, max: 60000, label: 'Цель шагов', int: true });
  D.profile = Object.assign(D.profile || {}, { stepsGoal: v }); persist('profile'); Sheet.close(); render(); toast(`Цель: ${fmt(v)} шагов в день`);
});
ACT.activityAdd = (el) => {
  const date = el.dataset.date || todayISO();
  Sheet.open({ title: 'Добавить активность', body: `<form data-sub="activitySave" class="form" data-date="${date}">
    <label>Вид активности<select class="input" name="type">${ACTIVITIES.map((a) => `<option value="${a.id}">${a.name}</option>`).join('')}</select></label>
    <label>Длительность, мин<input class="input" name="min" inputmode="numeric" placeholder="30"></label>
    <p class="muted sm">Калории оцениваются по MET × вес (${fmt(curWeight(), 1)} кг) × время. Это приблизительная оценка.</p>
    <button class="btn primary block">Добавить</button></form>` });
};
ACT.activitySave = validated((f) => {
  const min = readNum(f, 'min', { min: 1, max: 600, label: 'Длительность' });
  const a = ACTIVITIES.find((x) => x.id === f.type.value);
  const date = f.dataset.date; const d = ensureDay(date);
  d.activities.push({ id: uid(), type: a.id, name: a.name, min, kcal: Math.round(a.met * curWeight() * min / 60) });
  saveDay(date); Sheet.close(); render(); toast('Активность добавлена');
});
ACT.activityDel = (el) => { const d = ensureDay(el.dataset.date); d.activities = d.activities.filter((a) => a.id !== el.dataset.id); saveDay(el.dataset.date); render(); };



/* ============================================================
   ДНЕВНИК ПИТАНИЯ
   ============================================================ */
PAGES.diary = {
  title: 'Дневник', icon: 'book',
  render() {
    const date = App.diaryDate; const day = getDay(date); const t = dayTotals(day); const T = targets(); const budget = dayBudget(date);
    return `
    <div class="datebar card">
      <button class="icon-btn" data-act="diaryShift" data-v="-1" aria-label="Предыдущий день">${ic('left')}</button>
      <button class="datebtn" data-act="diaryCal"><b>${fmtDate(date)}</b><small>${WD_FULL[parseISO(date).getDay()]}, ${fmtDate(date, { full: true })}</small></button>
      <button class="icon-btn" data-act="diaryShift" data-v="1" aria-label="Следующий день">${ic('right')}</button>
    </div>

    <section class="card sumcard">
      <div class="sumtop"><div><span class="muted">Калории</span><div class="bignum">${fmt(t.kcal)}<small> / ${fmt(budget)}</small></div></div>
        <div class="right"><span class="muted">${budget - t.kcal >= 0 ? 'Осталось' : 'Сверх нормы'}</span><div class="bignum ${budget - t.kcal < 0 ? 'over-t' : ''}">${fmt(Math.abs(budget - t.kcal))}</div></div></div>
      ${Charts.bar(t.kcal, budget)}
      <div class="mgrid mt12">
        ${[['p', 'Белки', 'var(--cp)'], ['f', 'Жиры', 'var(--cf)'], ['c', 'Углеводы', 'var(--cc)'], ['fib', 'Клетчатка', 'var(--muted)']].map(([k, n, col]) => `<div><div class="row between"><small>${n}</small><small class="muted">${fmt(t[k])}/${fmt(T[k])} г</small></div>${Charts.bar(t[k], T[k], col, k === 'fib')}</div>`).join('')}
      </div>
      <p class="muted sm mt8">Сахара ${fmt(t.sug, 1)} г · Соль ${fmt(t.salt, 1)} г · Вода ${fmt(dayWater(day))} мл</p>
      <div class="row between mt8 day-steps"><span>${ic('steps', 16)} Шаги: <b>${day.steps != null ? fmt(day.steps) : '—'}</b> <span class="muted">из ${fmt(T.steps)}</span></span><button class="link-btn" data-act="stepsEdit" data-date="${date}">${day.steps != null ? 'Изменить' : 'Ввести'}</button></div>
    </section>

    ${MEALS.map((m) => mealCardHTML(day, m, date)).join('')}

    <section class="card">
      <div class="card-h"><h3>${ic('edit', 18)}Заметка дня</h3></div>
      <textarea class="input" rows="2" data-in="dayNote" placeholder="Самочувствие, сон, особенности дня…" maxlength="500">${esc(day.note || '')}</textarea>
      <div class="row gap8 wrap mt12">
        <button class="btn sm" data-act="copyDay">${ic('copy', 16)}Копировать день</button>
        <button class="btn sm" data-act="quickAdd" data-date="${date}" data-meal="${autoMeal()}">${ic('edit', 16)}Свои ккал и БЖУ</button>
        <button class="btn sm" data-act="aiPhoto" data-date="${date}" data-meal="${autoMeal()}">${ic('camera', 16)}Еда по фото</button>
        <button class="btn sm" data-act="aiText" data-date="${date}" data-meal="${autoMeal()}">${ic('spark', 16)}Описать словами</button>
      </div>
    </section>`;
  },
};
function mealCardHTML(day, m, date) {
  const items = day.meals[m.id] || []; const mt = mealTotals(day, m.id);
  return `<section class="card meal">
    <div class="card-h"><div><h3>${ic(m.icon, 18)}${m.name}</h3><small class="muted">${items.length ? `${fmt(mt.kcal)} ккал · Б ${fmt(mt.p)} · Ж ${fmt(mt.f)} · У ${fmt(mt.c)}` : 'Пусто'}</small></div>
      <div class="row gap4">${items.length ? `<button class="icon-btn" data-act="mealMenu" data-meal="${m.id}" aria-label="Действия с приёмом пищи">${ic('grid', 18)}</button>` : ''}
      <button class="icon-btn accent" data-act="pick" data-meal="${m.id}" data-date="${date}" aria-label="Добавить">${ic('plus', 18)}</button></div></div>
    ${items.length ? `<div class="items">${items.map((it) => { const n = itemN(it); return `
      <button class="item" data-act="itemEdit" data-meal="${m.id}" data-id="${it.id}">
        <div class="grow"><b>${esc(it.name)}</b><small class="muted">${it.unit ? unitText(it.unit, it.unit.n) + ' · ' : ''}${it.quick && it.quick.noG ? 'своя запись' : fmt(it.g)} ${it.quick && it.quick.noG ? '' : isWaterItem(it) || /напит|сок|чай|кофе|компот|кефир|молоко|айран|кола|лимонад|вода/i.test(it.name) ? 'мл' : 'г'}${isWaterItem(it) ? ' · в воду' : ''}${it.oil ? ` + масло ${fmt(it.oil.g)} г` : ''}${it.brand && it.brand !== G ? ' · ' + esc(it.brand) : ''} · ${macroLine(n)}</small></div>
        <span class="kcal">${fmt(n.kcal)}</span></button>`; }).join('')}</div>` : ''}
  </section>`;
}
ACT.diaryShift = (el) => { App.diaryDate = addDays(App.diaryDate, +el.dataset.v); render(); };
let _noteT; ACT.dayNote = (el) => { const d = ensureDay(App.diaryDate); d.note = el.value.slice(0, 500); clearTimeout(_noteT); _noteT = setTimeout(() => saveDay(App.diaryDate), 400); };
ACT.diaryCal = () => openCalendar({ title: 'Календарь питания', selected: App.diaryDate, onPick: (d) => { App.diaryDate = d; render(); } });

/* Календарь питания/истории — месяц с отметками */
function openCalendar({ title, selected, onPick, mode = 'food' }) {
  let month = selected.slice(0, 7);
  const draw = () => {
    const [y, mo] = month.split('-').map(Number); const first = new Date(y, mo - 1, 1); const startWd = (first.getDay() + 6) % 7;
    const daysIn = new Date(y, mo, 0).getDate(); const T = targets();
    let cells = ''; for (let i = 0; i < startWd; i++) cells += '<span></span>';
    for (let d = 1; d <= daysIn; d++) {
      const iso = `${month}-${String(d).padStart(2, '0')}`; const day = D.days[iso];
      let mark = ''; let cls = '';
      if (mode === 'food' && day && dayHasFood(day)) { const k = dayTotals(day).kcal; cls = k > T.kcal * 1.05 ? 'm-over' : 'm-ok'; mark = `<small>${fmt(k)}</small>`; }
      if (mode === 'wo' && workoutsOn(iso).length) { cls = 'm-ok'; mark = `<small>${workoutsOn(iso).length} трен.</small>`; }
      if (mode === 'act') { const b = dayBurned(iso).total; if (b > 0) { cls = 'm-ok'; mark = `<small>${fmt(b)}</small>`; } }
      cells += `<button class="cal-d ${cls} ${iso === selected ? 'sel' : ''} ${iso === todayISO() ? 'today' : ''}" data-d="${iso}"><b>${d}</b>${mark}</button>`;
    }
    Sheet.setBody(`<div class="cal-h"><button class="icon-btn" data-k="prev">${ic('left')}</button><b>${MONTHS_N[mo - 1]} ${y}</b><button class="icon-btn" data-k="next">${ic('right')}</button></div>
      <div class="cal-g">${['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((w) => `<span class="cal-w">${w}</span>`).join('')}${cells}</div>
      ${mode === 'food' ? '<p class="muted sm mt12"><i class="dot ok"></i> в пределах нормы <i class="dot over"></i> выше нормы · число — ккал</p>' : ''}
      <button class="btn block mt12" data-k="today">Сегодня</button>`);
    const s = Sheet.top();
    s.querySelector('[data-k=prev]').onclick = () => { month = isoOf(new Date(y, mo - 2, 1)).slice(0, 7); draw(); };
    s.querySelector('[data-k=next]').onclick = () => { month = isoOf(new Date(y, mo, 1)).slice(0, 7); draw(); };
    s.querySelector('[data-k=today]').onclick = () => { Sheet.close(); onPick(todayISO()); };
    s.querySelectorAll('.cal-d').forEach((b) => { b.onclick = () => { Sheet.close(); onPick(b.dataset.d); }; });
  };
  Sheet.open({ title, body: '' }); draw();
}

/* ---------- Выбор продукта (поиск, недавние, избранное, мои, блюда) ---------- */
ACT.pick = (el) => openFoodPicker({ date: el.dataset.date || App.diaryDate, meal: el.dataset.meal || autoMeal() });
function openFoodPicker(ctx) {
  ctx.mode = ctx.mode || 'diary'; ctx.fromPicker = true; let tab = 'search'; let q = '';
  const mealName = ctx.mode === 'diary' ? (MEALS.find((m) => m.id === ctx.meal) || {}).name : '';
  const s = Sheet.open({
    title: ctx.title || `Добавить: ${mealName}`, wide: true,
    body: `<div class="search"><span>${ic('search', 18)}</span><input class="input" type="search" placeholder="Поиск продукта или блюда…" data-k="q" autocomplete="off"></div>
      ${ctx.mode === 'diary' ? `<div class="quick-row">
        <button class="qbtn" data-k="scan">${ic('scan', 20)}<span>Штрихкод</span></button>
        <button class="qbtn" data-k="photo">${ic('camera', 20)}<span>Фото еды</span></button>
        <button class="qbtn" data-k="aitext">${ic('spark', 20)}<span>Описать словами</span></button>
        <button class="qbtn" data-k="quick">${ic('edit', 20)}<span>Свои ккал и БЖУ</span></button>
        <button class="qbtn" data-k="create">${ic('plus', 20)}<span>Новый продукт</span></button></div>` : ''}
      <div class="tabs" data-k="tabs">${[['search', 'Все'], ['recent', 'Недавние'], ['fav', 'Избранное'], ['mine', 'Мои'], ['dishes', 'Блюда']].map(([k, n]) => `<button class="tab ${k === tab ? 'on' : ''}" data-tab="${k}">${n}</button>`).join('')}</div>
      <div class="results" data-k="res"></div>`,
  });
  const res = s.querySelector('[data-k=res]'); const inp = s.querySelector('[data-k=q]'); const online = new Map();
  const draw = () => {
    let list;
    if (q) list = searchFoods(q, 80);
    else if (tab === 'recent') list = D.meta.recent.map(findFood).filter(Boolean);
    else if (tab === 'fav') list = D.meta.favorites.map(findFood).filter(Boolean);
    else if (tab === 'mine') list = Object.values(D.foods).map(customAsFood);
    else if (tab === 'dishes') list = Object.values(D.recipes).map(recipeAsFood);
    else list = [...D.meta.recent.slice(0, 8).map(findFood).filter(Boolean), ...searchFoods('', 60).filter((f) => !D.meta.recent.slice(0, 8).includes(f.id))];
    if (ctx.exclude) list = list.filter((f) => f.id !== ctx.exclude);
    const aiBtn = ctx.mode === 'diary' && q.trim().length >= 2 ? `<button class="btn sm" data-k2="aitext">${ic('spark', 16)}Оценить «${esc(q.slice(0, 30))}» через AI</button>` : '';
    res.innerHTML = list.length ? list.map(foodRowHTML).join('') + (aiBtn ? `<div class="ai-hint muted sm">Нет нужного варианта? ${aiBtn}</div>` : '')
      : `<div class="empty sm">${ic('search', 24)}<b>В базе FORMA нет</b><p>${OnlineFoods.available() && norm(q).length >= 3 ? 'Ищу в интернете ниже — или оцените блюдо через AI, или создайте продукт сами.' : 'Оцените блюдо через AI, создайте продукт сами или отсканируйте штрихкод.'}</p><div class="row gap8 wrap center">${aiBtn}<button class="btn sm" data-k2="create">Создать продукт${q ? ` «${esc(q.slice(0, 30))}»` : ''}</button></div></div>`;
    OnlineFoods.attach(res, q, online);
  };
  inp.addEventListener('input', () => { q = inp.value; draw(); });
  s.querySelector('[data-k=tabs]').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (!b) return; tab = b.dataset.tab; q = ''; inp.value = ''; s.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x === b)); draw(); });
  res.addEventListener('click', (e) => {
    const c = e.target.closest('[data-k2=create]'); if (c) { openFoodForm({ name: q, afterSave: (f) => openAmount(customAsFood(f), ctx) }); return; }
    if (e.target.closest('[data-k2=aitext]')) { Sheet.close(); ACT.aiText({ dataset: { date: ctx.date, meal: ctx.meal, q } }); return; }
    const fav = e.target.closest('[data-fav]'); if (fav) { e.stopPropagation(); toggleFav(fav.dataset.fav); draw(); return; }
    const row = e.target.closest('[data-food]'); if (row) { let f = findFood(row.dataset.food); if (!f && online.has(row.dataset.food)) f = saveExternalFood(online.get(row.dataset.food)); if (f) openAmount(f, ctx); }
  });
  const on = (k, fn) => { const b = s.querySelector(`[data-k=${k}]`); if (b) b.onclick = fn; };
  on('scan', () => { Sheet.closeAll(); App.scanCtx = { date: ctx.date, meal: ctx.meal }; go('scan'); });
  on('photo', () => { Sheet.close(); ACT.aiPhoto({ dataset: { date: ctx.date, meal: ctx.meal } }); });
  on('quick', () => { Sheet.close(); ACT.quickAdd({ dataset: { date: ctx.date, meal: ctx.meal, q } }); });
  on('aitext', () => { Sheet.close(); ACT.aiText({ dataset: { date: ctx.date, meal: ctx.meal, q } }); });
  on('create', () => openFoodForm({ name: q, afterSave: (f) => openAmount(customAsFood(f), ctx) }));
  draw(); setTimeout(() => { if (window.innerWidth > 700) inp.focus(); }, 120);
}
/* ---------- Поиск в мировой базе Open Food Facts (миллионы товаров со штрихкодами) ---------- */
const OnlineFoods = {
  cache: new Map(), timer: null, seq: 0, calls: [],
  available() { return !IN_FRAME && navigator.onLine !== false; },
  async search(q) {
    const key = norm(q); if (this.cache.has(key)) return this.cache.get(key);
    const now = Date.now(); this.calls = this.calls.filter((t) => now - t < 60000);
    if (this.calls.length >= 9) throw { code: 'rate' }; // лимит базы — 10 запросов в минуту
    this.calls.push(now);
    const url = 'https://world.openfoodfacts.org/cgi/search.pl?search_simple=1&action=process&json=1&page_size=24&sort_by=unique_scans_n&fields=code,product_name,product_name_ru,brands,nutriments,serving_quantity&search_terms=' + encodeURIComponent(q);
    const r = await withTimeout(fetch(url), 10000); if (!r.ok) throw { code: 'http' };
    const j = await r.json(); const seen = new Set();
    const list = (j.products || []).map(offToFood).filter((f) => f && !seen.has(f.name + f.per.kcal) && seen.add(f.name + f.per.kcal));
    this.cache.set(key, list); return list;
  },
  attach(res, q, online) {
    clearTimeout(this.timer); const my = ++this.seq;
    if (!q || norm(q).length < 3 || /^\d+$/.test(q.trim()) || !this.available()) return;
    const box = document.createElement('div'); box.className = 'online-res';
    box.innerHTML = `<div class="online-h">${ic('search', 14)}В интернете · Open Food Facts</div><p class="muted sm online-st">Ищу…</p>`;
    res.appendChild(box);
    this.timer = setTimeout(async () => {
      try {
        const list = await this.search(q); if (my !== this.seq || !box.isConnected) return;
        list.forEach((f) => online.set(f.id, f));
        box.innerHTML = `<div class="online-h">${ic('search', 14)}В интернете · Open Food Facts</div>` + (list.length ? list.map((f) => foodRowHTML(f)).join('') + '<p class="muted sm online-st">Данные открытой базы — сверьте с упаковкой. Выбранный продукт сохранится у вас и будет доступен без интернета.</p>' : '<p class="muted sm online-st">В интернете тоже ничего. Попробуйте другое название или создайте продукт.</p>');
      } catch (e) {
        if (my !== this.seq || !box.isConnected) return;
        box.querySelector('.online-st').textContent = e && e.code === 'rate' ? 'Слишком много поисков подряд — подождите минуту.' : 'Онлайн-база сейчас не отвечает. Попробуйте позже.';
      }
    }, 800);
  },
};
function offToFood(p) {
  const n = p.nutriments || {}; const kcal = n['energy-kcal_100g'] != null ? +n['energy-kcal_100g'] : (n.energy_100g ? n.energy_100g / 4.184 : null);
  const name = String(p.product_name_ru || p.product_name || '').trim();
  if (!name || kcal == null || !(kcal >= 0 && kcal <= 950)) return null;
  const brand = String(Array.isArray(p.brands) ? (p.brands[0] || '') : (p.brands || '')).split(',')[0].trim();
  return { id: 'off_' + p.code, name, brand, cat: 'custom', barcode: p.code,
    per: { kcal: r1(kcal), p: r1(+n.proteins_100g || 0), f: r1(+n.fat_100g || 0), c: r1(+n.carbohydrates_100g || 0), fib: r1(+n.fiber_100g || 0), sug: r1(+n.sugars_100g || 0), salt: r1(+n.salt_100g || 0) },
    portion: { g: +p.serving_quantity || 100, label: 'порция' }, external: 'Open Food Facts' };
}
function saveExternalFood(found) {
  const ex = found.barcode ? Object.values(D.foods).find((x) => sameCode(x.barcode, found.barcode)) : null;
  if (ex) return customAsFood(ex);
  const id = uid(); D.foods[id] = { kind: 'food', id, name: found.name, brand: found.brand, cat: 'custom', barcode: found.barcode, per: found.per, portion: found.portion, source: found.external, updated: Date.now() };
  persist('food-' + id); invalidateFoods(); return customAsFood(D.foods[id]);
}
function foodRowHTML(f) {
  return `<div class="frow" data-food="${f.id}" role="button" tabindex="0">
    <div class="grow"><b>${esc(f.name)}</b><small class="muted">${f.brand && f.brand !== G ? esc(f.brand) + ' · ' : ''}${fmt(f.per.kcal)} ккал · Б ${fmt(f.per.p, 1)} · Ж ${fmt(f.per.f, 1)} · У ${fmt(f.per.c, 1)} <span class="dim">/100 г</span></small></div>
    ${f.external ? '<span class="tag">интернет</span>' : f.store ? '<span class="tag">магазин</span>' : f.recipe ? '<span class="tag">блюдо</span>' : f.custom ? '<span class="tag">моё</span>' : ''}
    ${f.external ? '' : `<button class="icon-btn fav ${isFav(f.id) ? 'on' : ''}" data-fav="${f.id}" aria-label="Избранное">${ic('star', 18)}</button>`}
  </div>`;
}

/* ---------- Количество продукта (добавление / редактирование) ---------- */
const OIL_STEPS = [[0, 'нет'], [5, '1 ч. л.'], [10, '1 ст. л.'], [20, '2 ст. л.']];
/* Единица для счёта «штуками/порциями»: из подписи порции («1 яйцо», «2 яйца» → 1 шт = половина, «стакан», «тарелка»…) */
function foodUnit(food) {
  const pt = food && food.portion; if (!pt || !(pt.g > 0)) return null;
  const label = String(pt.label || '').trim(); if (!label || label === '100 г') return null;
  const m = label.match(/^(\d+)(?:\s*[–-]\s*\d+)?\s*(.*)$/);
  if (m) {
    const n = +m[1]; const rest = m[2].trim();
    const name = /яйц/.test(rest) ? 'яйцо' : /шт/.test(rest) || !rest ? 'шт' : n > 1 ? 'шт' : rest;
    return { g: r1(pt.g / Math.max(1, n)), name };
  }
  return { g: pt.g, name: label };
}
function unitText(u, n) { return `${fmt(n, 2)} × ${u.name}`; }
function openAmount(food, ctx) {
  const editing = ctx.item; let meal = ctx.meal; const mode = ctx.mode || 'diary';
  const unit = foodUnit(food) || (editing && editing.unit) || null;
  let useUnit = !!unit && (editing ? !!editing.unit : true);
  let g = editing ? editing.g : (unit ? unit.g : 100);
  let cnt = editing && editing.unit ? editing.unit.n : 1;
  const oilOk = mode === 'diary' && !['drink', 'sweet', 'oil', 'sport'].includes(food.cat);
  const oil = editing && editing.oil ? { ...editing.oil } : { t: 'veg', g: 0 };
  const friedNote = /жарен|фри|глазунь|яичниц|в кляре|панировк|котлет|чебурек|беляш|пончик|драник|оладь|блин/i.test(food.name || '') && !/без масла/i.test(food.name || '');
  const chips = [...new Set([food.portion && food.portion.g, 50, 100, 150, 200].filter(Boolean))];
  const s = Sheet.open({
    title: editing ? 'Изменить запись' : food.name,
    body: `${editing ? `<p class="lead">${esc(food.name)}</p><button class="link-btn" data-k="manual">${ic('edit', 14)} Вписать свои ккал и БЖУ</button>` : ''}<p class="muted sm">${food.brand && food.brand !== G ? esc(food.brand) + ' · ' : ''}на 100 г: ${fmt(food.per.kcal)} ккал · Б ${fmt(food.per.p, 1)} · Ж ${fmt(food.per.f, 1)} · У ${fmt(food.per.c, 1)}</p>
      ${unit ? `<div class="seg mt8" data-k="modes"><button class="${useUnit ? 'on' : ''}" data-m="u">Штуки / порции</button><button class="${useUnit ? '' : 'on'}" data-m="g">Граммы</button></div>` : ''}
      <div data-k="uBox" ${useUnit ? '' : 'hidden'}>
        <div class="amount"><button class="icon-btn soft lg" data-k="um">${ic('minus')}</button>
          <label class="amount-in"><input class="input big" data-k="n" inputmode="decimal" value="${cnt}" aria-label="Количество"><span>${unit ? '× ' + esc(unit.name) : ''}</span></label>
          <button class="icon-btn soft lg" data-k="up">${ic('plus')}</button></div>
        <p class="muted sm center">${unit ? `1 ${esc(unit.name)} ≈ ${fmt(unit.g)} г` : ''} · <span data-k="ug"></span></p>
        <div class="chips">${[0.5, 1, 2, 3, 4, 5].map((n) => `<button class="chip" data-n="${n}">${n === 0.5 ? '½' : n}</button>`).join('')}</div>
      </div>
      <div data-k="gBox" ${useUnit ? 'hidden' : ''}>
        <div class="amount"><button class="icon-btn soft lg" data-k="m">${ic('minus')}</button>
          <label class="amount-in"><input class="input big" data-k="g" inputmode="decimal" value="${g}" aria-label="Граммы"><span>г</span></label>
          <button class="icon-btn soft lg" data-k="p">${ic('plus')}</button></div>
        <div class="chips">${chips.map((c) => `<button class="chip" data-g="${c}">${c === (food.portion && food.portion.g) && !/\d/.test(food.portion.label) ? esc(food.portion.label) + ' · ' : ''}${c} г</button>`).join('')}</div>
      </div>
      ${oilOk ? `<div class="oil-box mt12">
        <div class="row between"><b class="sm">${ic('drop', 16)} Готовили на масле?</b><select class="input sm oil-type" data-k="ot">${[['veg', 'растительное'], ['butter', 'сливочное'], ['ghee', 'топлёное'], ['fat', 'жир / сало']].map(([k, n]) => `<option value="${k}" ${oil.t === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        <div class="chips" data-k="oil">${OIL_STEPS.map(([g, l]) => `<button class="chip ${oil.g === g ? 'on' : ''}" data-og="${g}">${l}</button>`).join('')}<button class="chip ${oil.g && !OIL_STEPS.some(([g]) => g === oil.g) ? 'on' : ''}" data-og="custom">своё</button></div>
        <label class="oil-custom" ${oil.g && !OIL_STEPS.some(([g]) => g === oil.g) ? '' : 'hidden'}>Масла, г<input class="input" data-k="og" inputmode="decimal" value="${oil.g || ''}"></label>
        ${friedNote ? '<p class="muted sm">У этого продукта масло уже учтено в калорийности. Добавляйте, только если масла было заметно больше обычного.</p>' : '<p class="muted sm">1 ч. л. ≈ 5 г ≈ 45 ккал · 1 ст. л. ≈ 10 г ≈ 90 ккал</p>'}
      </div>` : ''}
      ${mode === 'diary' ? `<div class="seg mt12" data-k="meals">${MEALS.map((m) => `<button class="${m.id === meal ? 'on' : ''}" data-meal="${m.id}">${m.name}</button>`).join('')}</div>` : ''}
      <div class="preview" data-k="prev"></div>`,
    foot: `${editing ? `<button class="btn ghost danger-t" data-k="del">${ic('trash', 16)}Удалить</button>` : `<button class="icon-btn fav ${isFav(food.id) ? 'on' : ''}" data-k="fav" aria-label="В избранное">${ic('star')}</button>`}
      <button class="btn primary grow" data-k="ok">${editing ? 'Сохранить' : (mode === 'diary' ? 'Добавить в дневник' : 'Добавить')}</button>`,
  });
  const inp = s.querySelector('[data-k=g]'); const nIn = s.querySelector('[data-k=n]'); const prev = s.querySelector('[data-k=prev]');
  const oilBox = s.querySelector('.oil-box');
  if (oilBox) {
    const ogIn = oilBox.querySelector('[data-k=og]'); const custom = oilBox.querySelector('.oil-custom');
    oilBox.querySelector('[data-k=oil]').onclick = (e) => {
      const b = e.target.closest('[data-og]'); if (!b) return;
      oilBox.querySelectorAll('[data-og]').forEach((c) => c.classList.toggle('on', c === b));
      if (b.dataset.og === 'custom') { custom.hidden = false; oil.g = num(ogIn.value) || 0; ogIn.focus(); } else { custom.hidden = true; oil.g = +b.dataset.og; }
      upd();
    };
    ogIn.addEventListener('input', () => { oil.g = num(ogIn.value) || 0; upd(); });
    oilBox.querySelector('[data-k=ot]').onchange = (e) => { oil.t = e.target.value; upd(); };
  }
  const grams = () => (useUnit ? (num(nIn.value) || 0) * unit.g : num(inp.value));
  const upd = () => {
    const v = grams(); const ok = Number.isFinite(v) && v > 0 && v <= 5000;
    (useUnit ? nIn : inp).classList.toggle('invalid', !ok);
    if (useUnit) { s.querySelector('[data-k=ug]').textContent = ok ? `всего ${fmt(v)} г` : 'укажите количество'; }
    const n = addN(scaleN(food.per, ok ? v : 0), oilN(oil));
    prev.innerHTML = `<div class="pv-k"><b>${fmt(n.kcal)}</b><span>ккал</span></div><div><b>${fmt(n.p, 1)}</b><span>белки</span></div><div><b>${fmt(n.f, 1)}</b><span>жиры</span></div><div><b>${fmt(n.c, 1)}</b><span>углеводы</span></div>`;
    s.querySelectorAll('[data-g]').forEach((c) => c.classList.toggle('on', +c.dataset.g === num(inp.value)));
    s.querySelectorAll('[data-n]').forEach((c) => c.classList.toggle('on', +c.dataset.n === num(nIn.value)));
  };
  inp.addEventListener('input', upd); nIn.addEventListener('input', upd);
  s.querySelector('[data-k=m]').onclick = () => { inp.value = Math.max(1, r0((num(inp.value) || 0) - 10)); upd(); };
  s.querySelector('[data-k=p]').onclick = () => { inp.value = r0((num(inp.value) || 0) + 10); upd(); };
  s.querySelector('[data-k=um]').onclick = () => { const v = num(nIn.value) || 0; nIn.value = v > 1 ? Math.round((v - 1) * 10) / 10 : 0.5; upd(); };
  s.querySelector('[data-k=up]').onclick = () => { const v = num(nIn.value) || 0; nIn.value = v < 1 ? 1 : Math.round((v + 1) * 10) / 10; upd(); };
  s.querySelectorAll('[data-g]').forEach((c) => { c.onclick = () => { inp.value = c.dataset.g; upd(); }; });
  s.querySelectorAll('[data-n]').forEach((c) => { c.onclick = () => { nIn.value = c.dataset.n; upd(); }; });
  const modes = s.querySelector('[data-k=modes]');
  if (modes) modes.onclick = (e) => {
    const b = e.target.closest('[data-m]'); if (!b) return; const v = grams();
    useUnit = b.dataset.m === 'u';
    if (useUnit && v > 0) nIn.value = Math.round(v / unit.g * 10) / 10; else if (!useUnit && v > 0) inp.value = r0(v);
    modes.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    s.querySelector('[data-k=uBox]').hidden = !useUnit; s.querySelector('[data-k=gBox]').hidden = useUnit; upd();
  };
  const segs = s.querySelector('[data-k=meals]'); if (segs) segs.onclick = (e) => { const b = e.target.closest('[data-meal]'); if (!b) return; meal = b.dataset.meal; segs.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); };
  const fav = s.querySelector('[data-k=fav]'); if (fav) fav.onclick = () => { toggleFav(food.id); fav.classList.toggle('on', isFav(food.id)); toast(isFav(food.id) ? 'Добавлено в избранное' : 'Убрано из избранного'); };
  const del = s.querySelector('[data-k=del]'); if (del) del.onclick = () => { ctx.onDelete && ctx.onDelete(); Sheet.close(); };
  const man = s.querySelector('[data-k=manual]'); if (man) man.onclick = () => { Sheet.close(); openManual({ date: ctx.date, meal: ctx.meal, item: editing }); };
  s.querySelector('[data-k=ok]').onclick = () => {
    const v = grams(); if (!(v > 0 && v <= 5000)) { markInvalid(useUnit ? nIn : inp, useUnit ? 'Укажите количество (всего до 5000 г)' : 'Укажите вес от 1 до 5000 г'); return; }
    const u = useUnit ? { n: num(nIn.value), name: unit.name, g: unit.g } : null;
    if (!(oil.g >= 0 && oil.g <= 200)) { toast('Масла — от 0 до 200 г', 'err'); return; }
    const o = oil.g > 0 ? { t: oil.t, g: r1(oil.g) } : null;
    if (ctx.onDone) { Sheet.close(); if (ctx.fromPicker) Sheet.close(); ctx.onDone(food, r1(v), meal, u); return; }
    if (editing) {
      const day = ensureDay(ctx.date); const from = day.meals[ctx.meal]; const it = from.find((x) => x.id === editing.id);
      if (it) { it.g = r1(v); if (u) it.unit = u; else delete it.unit; if (o) it.oil = o; else delete it.oil; if (meal !== ctx.meal) { day.meals[ctx.meal] = from.filter((x) => x.id !== it.id); day.meals[meal].push(it); } }
      saveDay(ctx.date); Sheet.closeAll(); render(); toast('Сохранено');
    } else {
      addToDiary(ctx.date, meal, food, r1(v), u, o); Sheet.closeAll(); render();
      toast(`${food.name} — ${u ? unitText(u, u.n) + ' (' + fmt(v) + ' г)' : fmt(v) + ' г'}${o ? ` + масло ${fmt(o.g)} г` : ''} добавлено в «${MEALS.find((m) => m.id === meal).name}»`);
    }
  };
  upd();
  setTimeout(() => { const f = useUnit ? nIn : inp; if (window.innerWidth > 700) f.select(); }, 150);
}
function addToDiary(date, meal, food, g, unit = null, oil = null) {
  const day = ensureDay(date);
  const it = { id: uid(), ref: food.id, name: food.name, brand: food.brand || '', g, per: clone(food.per) }; if (unit) it.unit = unit; if (oil) it.oil = oil;
  day.meals[meal].push(it);
  saveDay(date); if (food.id && !/^(q_|ai_)/.test(String(food.id))) pushRecent(food.id);
}
ACT.itemEdit = (el) => {
  const date = App.diaryDate; const day = ensureDay(date); const it = day.meals[el.dataset.meal].find((x) => x.id === el.dataset.id); if (!it) return;
  if (it.quick || String(it.ref || '').startsWith('q_')) { openManual({ date, meal: el.dataset.meal, item: it }); return; }
  const food = { id: it.ref, name: it.name, brand: it.brand, per: it.per, cat: (findFood(it.ref) || {}).cat, portion: (findFood(it.ref) || {}).portion || (it.unit ? { g: it.unit.g, label: '1 ' + it.unit.name } : null) };
  openAmount(food, { date, meal: el.dataset.meal, item: it, onDelete: () => { day.meals[el.dataset.meal] = day.meals[el.dataset.meal].filter((x) => x.id !== it.id); saveDay(date); render(); toast('Удалено'); } });
};

/* Свои калории и КБЖУ: вписать вручную (на всю порцию или на 100 г), по желанию сохранить в «Мои продукты».
   Также правка цифр у уже записанной еды (ctx.item). */
ACT.quickAdd = (el) => openManual({ date: el.dataset.date || App.diaryDate, meal: el.dataset.meal || autoMeal(), q: el.dataset.q || '' });
function openManual({ date, meal, item = null, q = '' }) {
  const tot = item ? itemN(item) : null; const noG = item && item.quick && item.quick.noG;
  const v = (x) => (x == null ? '' : r1(x));
  const s = Sheet.open({ title: item ? 'Изменить ккал и БЖУ' : 'Свои калории и БЖУ', body: `<form class="form" data-k="f" novalidate>
    <label>Название<input class="input" name="name" value="${esc(item ? item.name : q)}" placeholder="Например: обед в кафе, протеиновый батончик" maxlength="80"></label>
    <div class="seg" data-k="mode"><button type="button" class="on" data-m="total">На всю порцию</button><button type="button" data-m="per">На 100 г</button></div>
    <label>Вес, г<input class="input" name="g" inputmode="decimal" value="${item && !noG ? v(item.g) : ''}" placeholder="необязательно, например 250"></label>
    <div class="f2"><label>Калории, ккал<input class="input" name="kcal" inputmode="decimal" value="${tot ? v(tot.kcal) : ''}"></label><label>Белки, г<input class="input" name="p" inputmode="decimal" value="${tot ? v(tot.p) : ''}"></label>
      <label>Жиры, г<input class="input" name="f" inputmode="decimal" value="${tot ? v(tot.f) : ''}"></label><label>Углеводы, г<input class="input" name="c" inputmode="decimal" value="${tot ? v(tot.c) : ''}"></label></div>
    <p class="muted sm" data-k="chk">Можно вписать только калории или только БЖУ — калории тогда посчитаются сами.</p>
    <div class="f2"><label>Приём пищи<select class="input" name="meal">${MEALS.map((m) => `<option value="${m.id}" ${m.id === meal ? 'selected' : ''}>${m.name}</option>`).join('')}</select></label>
      <label>День<input class="input" type="date" name="date" value="${date}"></label></div>
    ${item ? '' : '<label class="chk-row"><input type="checkbox" name="save"><span>Сохранить в «Мои продукты», чтобы потом находить поиском</span></label>'}
    <button class="btn primary block">${item ? 'Сохранить' : 'Добавить в дневник'}</button></form>` });
  const f = s.querySelector('[data-k=f]'); let mode = 'total';
  const segs = s.querySelector('[data-k=mode]');
  segs.onclick = (e) => { const bt = e.target.closest('[data-m]'); if (!bt) return; mode = bt.dataset.m; segs.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === bt)); f.g.placeholder = mode === 'per' ? 'обязательно, например 250' : 'необязательно, например 250'; check(); };
  const vals = () => ({ g: num(f.g.value), kcal: num(f.kcal.value), p: num(f.p.value), f: num(f.f.value), c: num(f.c.value) });
  const check = () => {
    const x = vals(); const chk = s.querySelector('[data-k=chk]'); const has = ['p', 'f', 'c'].some((k) => Number.isFinite(x[k]));
    const est = (x.p || 0) * 4 + (x.f || 0) * 9 + (x.c || 0) * 4;
    if (!Number.isFinite(x.kcal) && has) chk.textContent = `Калории посчитаются по БЖУ: ≈ ${fmt(est)} ккал${mode === 'per' ? ' на 100 г' : ''}.`;
    else if (Number.isFinite(x.kcal) && has && x.kcal > 0 && Math.abs(est - x.kcal) / x.kcal > 0.25) chk.textContent = `⚠ По БЖУ выходит ≈ ${fmt(est)} ккал, а вписано ${fmt(x.kcal)}. Проверьте — возможно, опечатка.`;
    else if (mode === 'per' && x.g > 0 && Number.isFinite(x.kcal)) chk.textContent = `На ${fmt(x.g)} г выйдет ≈ ${fmt(x.kcal * x.g / 100)} ккал.`;
    else chk.textContent = 'Можно вписать только калории или только БЖУ — калории тогда посчитаются сами.';
  };
  f.addEventListener('input', check); check();
  f.onsubmit = validated((e) => {
    e.preventDefault();
    f.g.value = f.g.value.replace(/[\s ]/g, '');
    const g = readNum(f, 'g', { min: 1, max: 5000, required: mode === 'per', label: 'Вес' });
    const lim = mode === 'per' ? { kcal: 950, m: 100 } : { kcal: 6000, m: 600 };
    let kcal = readNum(f, 'kcal', { min: 0, max: lim.kcal, required: false, label: 'Калории' });
    const p = readNum(f, 'p', { min: 0, max: lim.m, required: false, label: 'Белки' });
    const fa = readNum(f, 'f', { min: 0, max: lim.m, required: false, label: 'Жиры' });
    const c = readNum(f, 'c', { min: 0, max: lim.m, required: false, label: 'Углеводы' });
    if (kcal == null && p == null && fa == null && c == null) { markInvalid(f.kcal, 'Впишите калории или белки/жиры/углеводы'); return; }
    if (kcal == null) kcal = r1((p || 0) * 4 + (fa || 0) * 9 + (c || 0) * 4);
    if (mode === 'per' && (p || 0) + (fa || 0) + (c || 0) > 101) { markInvalid(f.p, 'На 100 г белков, жиров и углеводов вместе не больше 100 г'); return; }
    const raw = { kcal, p: p || 0, f: fa || 0, c: c || 0, fib: 0, sug: 0, salt: 0 };
    // в дневнике храним «на 100 г» + граммы; без веса — условные 100 г = вся порция
    const grams = g || 100; const per = {};
    NK.forEach((k) => { per[k] = mode === 'per' || !g ? raw[k] : r1(raw[k] / g * 100); });
    const name = f.name.value.trim() || 'Своя запись';
    const d = /^\d{4}-\d{2}-\d{2}$/.test(f.date.value) ? f.date.value : date; const m = f.meal.value;
    const quick = g ? null : { noG: true };
    if (item) {
      const day = ensureDay(date); const from = day.meals[meal]; const it = from.find((x) => x.id === item.id);
      if (it) {
        Object.assign(it, { name, g: grams, per }); delete it.oil; delete it.unit; if (quick) it.quick = quick; else delete it.quick;
        if (d !== date || m !== meal) { day.meals[meal] = from.filter((x) => x.id !== it.id); ensureDay(d).meals[m].push(it); saveDay(d); }
      }
      saveDay(date); Sheet.closeAll(); render(); toast('Сохранено'); return;
    }
    let food = { id: 'q_' + uid(), name, brand: '', per };
    if (f.save && f.save.checked) {
      const id = uid(); D.foods[id] = { kind: 'food', id, name, brand: '', cat: 'custom', barcode: '', per, portion: { g: grams, label: g ? 'порция' : '1 порция' }, updated: Date.now() };
      persist('food-' + id); invalidateFoods(); food = customAsFood(D.foods[id]);
    }
    addToDiary(d, m, food, grams);
    const day = ensureDay(d); const last = day.meals[m][day.meals[m].length - 1]; if (quick && last) { last.quick = quick; saveDay(d); }
    Sheet.closeAll(); if (App.page === 'diary') App.diaryDate = d; render();
    toast(`Добавлено: ${name} — ${fmt(scaleN(per, grams).kcal)} ккал${f.save && f.save.checked ? ' · сохранено в «Мои продукты»' : ''}`);
  });
  setTimeout(() => { const first = item ? f.kcal : f.name; if (window.innerWidth > 700) first.focus(); }, 150);
}

/* Действия с приёмом пищи: копировать, сохранить как блюдо, очистить */
ACT.mealMenu = (el) => {
  const meal = el.dataset.meal; const mName = MEALS.find((m) => m.id === meal).name;
  const s = Sheet.open({ title: mName, body: `<div class="menu">
    <button data-k="copy">${ic('copy')}Копировать на другой день</button>
    <button data-k="recipe">${ic('fork')}Сохранить как блюдо</button>
    <button data-k="clear" class="danger-t">${ic('trash')}Очистить приём пищи</button></div>` });
  s.querySelector('[data-k=copy]').onclick = () => { Sheet.close(); copyMealDialog(App.diaryDate, meal); };
  s.querySelector('[data-k=recipe]').onclick = () => {
    Sheet.close(); const items = getDay(App.diaryDate).meals[meal];
    openRecipeEditor({ name: `${mName} ${fmtShort(App.diaryDate)}`, servings: 1, ingredients: items.flatMap((it) => [{ ref: it.ref, name: it.name, g: it.g, per: clone(it.per) }, ...(it.oil && it.oil.g > 0 ? [{ ref: null, name: OILS[it.oil.t].name[0].toUpperCase() + OILS[it.oil.t].name.slice(1), g: it.oil.g, per: clone(OILS[it.oil.t].per) }] : [])]) });
  };
  s.querySelector('[data-k=clear]').onclick = async () => {
    Sheet.close(); if (!(await confirmDlg(`Удалить все продукты из «${mName}»?`))) return;
    ensureDay(App.diaryDate).meals[meal] = []; saveDay(App.diaryDate); render(); toast('Очищено');
  };
};
function copyMealDialog(fromDate, meal) {
  const s = Sheet.open({ title: 'Копировать приём пищи', body: `<form class="form" data-k="f">
    <label>На дату<input class="input" type="date" name="d" value="${addDays(fromDate, 1)}"></label>
    <label>В приём пищи<select class="input" name="m">${MEALS.map((m) => `<option value="${m.id}" ${m.id === meal ? 'selected' : ''}>${m.name}</option>`).join('')}</select></label>
    <button class="btn primary block">Копировать</button></form>` });
  s.querySelector('[data-k=f]').onsubmit = (e) => {
    e.preventDefault(); const to = e.target.d.value; if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) { toast('Выберите дату', 'err'); return; }
    const src = getDay(fromDate).meals[meal]; const day = ensureDay(to);
    src.forEach((it) => day.meals[e.target.m.value].push(Object.assign(clone(it), { id: uid() })));
    saveDay(to); Sheet.close(); toast(`Скопировано: ${src.length} шт. → ${fmtDate(to)}`);
  };
}
ACT.copyDay = () => {
  const from = App.diaryDate; if (!dayHasFood(getDay(from))) { toast('В этом дне нет продуктов', 'warn'); return; }
  const s = Sheet.open({ title: 'Копировать весь день', body: `<form class="form" data-k="f"><label>На дату<input class="input" type="date" name="d" value="${addDays(from, 1)}"></label><button class="btn primary block">Копировать</button></form>` });
  s.querySelector('[data-k=f]').onsubmit = (e) => {
    e.preventDefault(); const to = e.target.d.value; if (!to) return; const day = ensureDay(to); const src = getDay(from);
    MEALS.forEach((m) => src.meals[m.id].forEach((it) => day.meals[m.id].push(Object.assign(clone(it), { id: uid() }))));
    saveDay(to); Sheet.close(); toast('День скопирован на ' + fmtDate(to));
  };
};

/* ============================================================
   БАЗА ПРОДУКТОВ
   ============================================================ */
PAGES.foods = {
  title: 'База продуктов', icon: 'db',
  render() {
    const cats = ['all', 'custom', 'recipe', ...Object.keys(FOOD_CATS).filter((k) => k !== 'custom' && k !== 'recipe' && (k !== 'store' || StoreFoods.list.length))];
    return `
    <div class="pagehead"><div><h1>База продуктов</h1><p class="muted">${fmt(BASE_FOODS.length + StoreFoods.list.length)} продуктов${StoreFoods.list.length ? ` (из них ${fmt(StoreFoods.list.length)} магазинных товаров со штрихкодами)` : ''} · ${Object.keys(D.foods).length} моих · ${Object.keys(D.recipes).length} блюд. Значения — на 100 г.</p></div>
      <div class="row gap8"><button class="btn" data-act="go" data-p="scan">${ic('scan', 18)}Сканер</button><button class="btn primary" data-act="foodNew">${ic('plus', 18)}Новый продукт</button></div></div>
    <div class="search big"><span>${ic('search', 20)}</span><input class="input" type="search" placeholder="Поиск по всей базе: название, производитель или штрихкод" value="${esc(App.foodQ)}" data-in="foodSearch" id="foodQ"></div>
    <div class="chips scroll">${cats.map((c) => `<button class="chip ${App.foodCat === c ? 'on' : ''}" data-act="foodCat" data-c="${c}">${c === 'all' ? 'Все' : FOOD_CATS[c]}</button>`).join('')}</div>
    <div class="card flush"><div id="foodList"></div></div>
    ${StoreFoods.list.length ? '<p class="muted sm mt8">Магазинные товары — из открытой базы <a href="https://openfoodfacts.org" target="_blank" rel="noopener">Open Food Facts</a> (лицензия ODbL). Данные вносят покупатели — сверяйте с упаковкой.</p>' : ''}`;
  },
  mount() { drawFoodList(); },
};
function drawFoodList() {
  const el = $('#foodList'); if (!el) return;
  let list = App.foodQ ? searchFoods(App.foodQ, 500) : allFoods();
  if (App.foodCat !== 'all') list = list.filter((f) => f.cat === App.foodCat || (App.foodCat === 'custom' && f.custom));
  const shown = list.slice(0, App.foodLimit);
  el.innerHTML = shown.length ? `<div class="ftable">${shown.map((f) => `
    <div class="frow" data-act="foodOpen" data-id="${f.id}" role="button" tabindex="0">
      <div class="grow"><b>${esc(f.name)}</b><small class="muted">${esc(f.brand && f.brand !== G ? f.brand : FOOD_CATS[f.cat] || '')}${f.barcode ? ' · ' + esc(f.barcode) : ''}</small></div>
      <div class="fnums"><span><b>${fmt(f.per.kcal)}</b>ккал</span><span class="hide-xs"><b>${fmt(f.per.p, 1)}</b>Б</span><span class="hide-xs"><b>${fmt(f.per.f, 1)}</b>Ж</span><span class="hide-xs"><b>${fmt(f.per.c, 1)}</b>У</span></div>
    </div>`).join('')}</div>${list.length > shown.length ? `<button class="btn block ghost" data-act="foodMore">Показать ещё (${list.length - shown.length})</button>` : ''}`
    : emptyState('search', 'Ничего не найдено', 'Попробуйте другое название или создайте продукт.', `<button class="btn" data-act="foodNew">Создать продукт</button>`);
}
ACT.foodSearch = (el) => { App.foodQ = el.value; App.foodLimit = 80; drawFoodList(); };
ACT.foodCat = (el) => { App.foodCat = el.dataset.c; App.foodLimit = 80; render(); };
ACT.foodMore = () => { App.foodLimit += 120; drawFoodList(); };
ACT.foodNew = () => openFoodForm({});
ACT.foodOpen = (el) => openFoodDetail(el.dataset.id);
ACT.go = (el) => go(el.dataset.p);

function nutrTable(per, g = 100) {
  const n = scaleN(per, g);
  const rows = [['Калорийность', n.kcal, 'ккал', 0], ['Белки', n.p, 'г', 1], ['Жиры', n.f, 'г', 1], ['Углеводы', n.c, 'г', 1], ['— в т.ч. сахара', n.sug, 'г', 1], ['Клетчатка', n.fib, 'г', 1], ['Соль', n.salt, 'г', 2]];
  return `<table class="ntable">${rows.map(([a, v, u, d]) => `<tr><td>${a}</td><td>${fmt(v, d)} ${u}</td></tr>`).join('')}</table>`;
}
function openFoodDetail(id) {
  const f = findFood(id); if (!f) { toast('Продукт не найден', 'err'); return; }
  const kcalP = f.per.p * 4, kcalF = f.per.f * 9, kcalC = f.per.c * 4; const sum = kcalP + kcalF + kcalC || 1;
  const s = Sheet.open({
    title: f.name, wide: true,
    body: `<p class="muted">${esc(f.brand || '')}${f.barcode ? ' · штрихкод ' + esc(f.barcode) : ''} · ${esc(FOOD_CATS[f.cat] || '')}</p>
      <div class="split mt12"><div><h4>На 100 г</h4>${nutrTable(f.per)}</div>
      <div><h4>Порция: ${esc(f.portion ? f.portion.label : '')} (${f.portion ? fmt(f.portion.g) : 100} г)</h4>${nutrTable(f.per, f.portion ? f.portion.g : 100)}
        <div class="ratio mt12"><i style="flex:${kcalP};background:var(--cp)"></i><i style="flex:${kcalF};background:var(--cf)"></i><i style="flex:${kcalC};background:var(--cc)"></i></div>
        <p class="muted sm">Энергия: белки ${fmt(kcalP / sum * 100)}% · жиры ${fmt(kcalF / sum * 100)}% · углеводы ${fmt(kcalC / sum * 100)}%</p></div></div>
      ${f.recipe ? `<p class="muted sm mt12">Блюдо считается из ингредиентов. Изменить состав можно в планировщике.</p>` : ''}`,
    foot: `<button class="icon-btn fav ${isFav(f.id) ? 'on' : ''}" data-k="fav" aria-label="Избранное">${ic('star')}</button>
      <button class="icon-btn" data-k="qr" aria-label="QR-код">${ic('qr')}</button>
      ${f.custom ? `<button class="icon-btn" data-k="edit" aria-label="Редактировать">${ic('edit')}</button><button class="icon-btn danger-t" data-k="del" aria-label="Удалить">${ic('trash')}</button>` : ''}
      ${f.recipe ? `<button class="icon-btn" data-k="redit" aria-label="Редактировать блюдо">${ic('edit')}</button>` : ''}
      ${f.base ? `<button class="btn ghost sm" data-k="copy">Копия для правки</button>` : ''}
      <button class="btn primary grow" data-k="add">В дневник</button>`,
  });
  const on = (k, fn) => { const b = s.querySelector(`[data-k=${k}]`); if (b) b.onclick = fn; };
  on('fav', () => { toggleFav(f.id); s.querySelector('[data-k=fav]').classList.toggle('on', isFav(f.id)); });
  on('qr', () => showQR(f.recipe ? 'recipe-' + f.rid : 'food-' + f.id.replace('_', '-'), f.name));
  on('add', () => openAmount(f, { date: App.page === 'diary' ? App.diaryDate : todayISO(), meal: autoMeal() }));
  on('edit', () => { Sheet.close(); openFoodForm({ food: D.foods[f.cid] }); });
  on('redit', () => { Sheet.close(); openRecipeEditor(D.recipes[f.rid]); });
  on('copy', () => { Sheet.close(); openFoodForm({ food: Object.assign({}, f, { id: null, brand: f.brand === G ? '' : f.brand, name: f.name + ' (моя версия)' }), isCopy: true }); });
  on('del', async () => {
    if (!(await confirmDlg(`Удалить продукт «${f.name}»? Записи в дневнике сохранятся.`))) return;
    delete D.foods[f.cid]; persist('food-' + f.cid); invalidateFoods(); Sheet.closeAll(); render(); toast('Продукт удалён');
  });
}

/* ---------- Создание и редактирование своего продукта ---------- */
function openFoodForm({ food = null, name = '', barcode = '', afterSave = null, isCopy = false, note = '' }) {
  const f = food || {}; const p = f.per || {};
  const v = (x) => (x == null || x === '' ? '' : x);
  Sheet.open({
    title: food && !isCopy && food.id ? 'Редактировать продукт' : 'Новый продукт', wide: true,
    body: `${note ? `<div class="banner info">${note}</div>` : ''}<form class="form" data-k="ff" novalidate>
      <label>Название*<input class="input" name="name" value="${esc(f.name || name)}" maxlength="100" placeholder="Например: Творог 5%"></label>
      <div class="f2"><label>Производитель<input class="input" name="brand" value="${esc(f.brand || '')}" maxlength="60"></label>
        <label>Категория<select class="input" name="cat">${Object.entries(FOOD_CATS).filter(([k]) => k !== 'recipe').map(([k, n]) => `<option value="${k}" ${(f.cat || 'custom') === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>
      <label>Штрихкод (EAN/UPC)<input class="input" name="barcode" inputmode="numeric" value="${esc(f.barcode || barcode)}" placeholder="необязательно"></label>
      <h4 class="mt8">Пищевая ценность на 100 г</h4>
      <div class="f4"><label>Ккал*<input class="input" name="kcal" inputmode="decimal" value="${v(p.kcal)}"></label><label>Белки*<input class="input" name="p" inputmode="decimal" value="${v(p.p)}"></label>
        <label>Жиры*<input class="input" name="f" inputmode="decimal" value="${v(p.f)}"></label><label>Углеводы*<input class="input" name="c" inputmode="decimal" value="${v(p.c)}"></label>
        <label>Клетчатка<input class="input" name="fib" inputmode="decimal" value="${v(p.fib)}"></label><label>Сахара<input class="input" name="sug" inputmode="decimal" value="${v(p.sug)}"></label>
        <label>Соль<input class="input" name="salt" inputmode="decimal" value="${v(p.salt)}"></label><label>Порция, г<input class="input" name="pg" inputmode="decimal" value="${v(f.portion && f.portion.g) || 100}"></label></div>
      <label>Название порции<input class="input" name="pl" value="${esc((f.portion && f.portion.label) || 'порция')}" maxlength="40"></label>
      <p class="muted sm" data-k="chk"></p>
      <button class="btn primary block">Сохранить продукт</button></form>`,
    onMount: (s) => {
      const form = s.querySelector('[data-k=ff]'); const chk = s.querySelector('[data-k=chk]');
      const check = () => {
        const k = num(form.kcal.value), pp = num(form.p.value), ff = num(form.f.value), cc = num(form.c.value);
        if ([k, pp, ff, cc].every(Number.isFinite) && k > 0) {
          const est = pp * 4 + ff * 9 + cc * 4; const dev = Math.abs(est - k) / k;
          chk.textContent = dev > 0.2 ? `⚠ По БЖУ выходит ≈${fmt(est)} ккал — проверьте значения (возможно, опечатка).` : `Проверка: по БЖУ ≈${fmt(est)} ккал — сходится.`;
        } else chk.textContent = '';
      };
      form.addEventListener('input', check); check();
      form.onsubmit = validated((e) => {
        e.preventDefault();
        const nm = readStr(form, 'name', { label: 'Название', max: 100 });
        const bc = form.barcode.value.replace(/\s/g, '');
        if (bc && !/^\d{8}$|^\d{12,14}$/.test(bc)) { markInvalid(form.barcode, 'Штрихкод: 8, 12, 13 или 14 цифр'); return; }
        const per = {
          kcal: readNum(form, 'kcal', { min: 0, max: 950, label: 'Ккал' }), p: readNum(form, 'p', { min: 0, max: 100, label: 'Белки' }),
          f: readNum(form, 'f', { min: 0, max: 100, label: 'Жиры' }), c: readNum(form, 'c', { min: 0, max: 100, label: 'Углеводы' }),
          fib: readNum(form, 'fib', { min: 0, max: 100, required: false, label: 'Клетчатка' }) || 0, sug: readNum(form, 'sug', { min: 0, max: 100, required: false, label: 'Сахара' }) || 0,
          salt: readNum(form, 'salt', { min: 0, max: 100, required: false, label: 'Соль' }) || 0,
        };
        if (per.p + per.f + per.c > 101) { markInvalid(form.p, 'Сумма Б+Ж+У не может быть больше 100 г на 100 г'); return; }
        const pg = readNum(form, 'pg', { min: 1, max: 3000, label: 'Порция' });
        if (bc) { const dup = Object.values(D.foods).find((x) => x.barcode === bc && x.id !== (food && !isCopy ? food.cid || food.id : null)); if (dup) { markInvalid(form.barcode, `Этот штрихкод уже у продукта «${dup.name}»`); return; } }
        const id = (food && !isCopy && (food.cid || food.id)) || uid();
        const rec = { kind: 'food', id, name: nm, brand: form.brand.value.trim(), cat: form.cat.value, barcode: bc, per, portion: { g: pg, label: form.pl.value.trim() || 'порция' }, updated: Date.now() };
        D.foods[id] = rec; persist('food-' + id); invalidateFoods();
        Sheet.close(); toast('Продукт сохранён'); if (afterSave) afterSave(rec); else render();
      });
    },
  });
}

/* ---------- QR-коды своих продуктов и блюд ---------- */
async function loadScript(src, globalName) {
  if (globalName && window[globalName]) return window[globalName];
  await new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Не удалось загрузить библиотеку')); document.head.appendChild(s); });
  return globalName ? window[globalName] : true;
}
async function showQR(hash, title) {
  const link = APP_URL + '#' + hash;
  const s = Sheet.open({ title: 'QR-код', body: `<div class="qrbox"><div data-k="qr" class="qr">Создаю QR-код…</div><b>${esc(title)}</b><p class="muted sm">Наведите сканер FORMA или камеру телефона — откроется карточка.</p><code class="mono sm">${esc(link)}</code></div>`, foot: `<button class="btn grow" data-k="copy">${ic('copy', 16)}Копировать ссылку</button>` });
  s.querySelector('[data-k=copy]').onclick = () => copyText(link, 'Ссылка скопирована');
  try {
    const qrcode = await loadScript('https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js', 'qrcode');
    const q = qrcode(0, 'M'); q.addData(link); q.make();
    s.querySelector('[data-k=qr]').innerHTML = q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  } catch (e) { s.querySelector('[data-k=qr]').textContent = 'Не удалось создать QR-код: нет доступа к библиотеке. Используйте ссылку ниже.'; }
}
