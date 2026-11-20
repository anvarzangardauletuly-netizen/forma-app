/* ============================================================
   FORMA — страницы: Планировщик, Аналитика, Профиль, AI-помощник, Онбординг
   ============================================================ */
'use strict';

/* ============================================================
   AI (возможность `sample` платформы Claude)
   ============================================================ */
const AI = {
  ok: false, imgs: false, sample: null,
  /* На своём сайте (Vercel) AI работает через серверную функцию Supabase «food-ai» — нужен вход в аккаунт */
  get server() { return Store.backend === 'supa' && !!Supa.client && !!Supa.user; },
  get photo() { return (this.ok && this.imgs) || this.server; },
  get food() { return this.ok || this.server; },
  async init() {
    if (!(window.claude && window.claude.use)) return;
    try {
      const s = await withTimeout(window.claude.use('sample'), 11000).catch(() => null);
      if (s) { this.sample = s; this.ok = true; try { const l = await s.limits(); this.imgs = !!(l && l.images); } catch (e) { this.imgs = false; } }
    } catch (e) { /* AI недоступен */ }
  },
  async json(prompt, images) {
    if (!this.ok) throw { code: 'not_granted' };
    const opts = {}; if (images) { if (!this.imgs) throw { code: 'no_images' }; opts.images = images; }
    if (typeof this.sample.json === 'function') {
      try { return await this.sample.json(prompt, opts); } catch (e) { if (e && e.code && e.code !== 'parse_error' && e.code !== 'invalid_json') throw e; }
    }
    const r = await this.sample(prompt, opts); return parseJSONLoose(r.text);
  },
  /* Задачи по еде: photo (фото тарелки), label (фото этикетки), text (описание словами).
     Внутри claude.ai — через sample, на сайте — через серверную функцию. */
  async task(task, { blob = null, grams = null, hint = '', text = '', ...extra } = {}) {
    if (this.server) {
      if (navigator.onLine === false) throw { code: 'offline' };
      const body = { task, grams, hint, text, lang: I18N.lang, ...extra };
      if (blob) body.image = await blobToB64(blob);
      const { data, error } = await withTimeout(Supa.client.functions.invoke('food-ai', { body }), 90000, 'AI не ответил вовремя');
      if (error) {
        let info = null; try { info = error.context && typeof error.context.json === 'function' ? await error.context.json() : null; } catch (e) { /* без тела */ }
        throw { code: (info && info.error) || error.code || 'ai_failed', message: error.message, limit: info && info.limit, premium: info && info.premium };
      }
      if (!data || !data.ok) throw { code: (data && data.error) || 'ai_failed' };
      return data.data;
    }
    const gramsLine = grams ? `\nПользователь взвесил: вся еда весит ${grams} г — распредели эту массу между позициями.` : '';
    const hintLine = hint ? `\nПодсказка пользователя: «${hint}».` : '';
    const ITEMS = `Верни ТОЛЬКО JSON: {"items":[{"name":"название на русском","grams":число,"kcal":ккал на 100г,"p":белки на 100г,"f":жиры на 100г,"c":углеводы на 100г,"fib":клетчатка на 100г}],"comment":"короткое пояснение на русском, что могло быть оценено неточно"}`;
    if (task === 'photo') return this.json(`Ты — нутрициолог. Определи продукты и блюда на фото, оцени массу каждого в граммах и пищевую ценность НА 100 г по типичным табличным данным.${gramsLine}${hintLine}
${ITEMS}
Если еды на фото нет — {"items":[],"comment":"на фото нет еды"}.`, [blob]);
    if (task === 'text') return this.json(`Ты — нутрициолог. Пользователь описал, что съел: «${text}».${grams ? ` Общая масса: ${grams} г.` : ''} Разбери на продукты/блюда (1–4 позиции), оцени массу каждого (если не указана — типичная порция) и пищевую ценность на 100 г. Это может быть блюдо любой кухни мира или товар из магазина.
${ITEMS}`);
    const d = await this.json(`Это фото упаковки продукта. Найди таблицу пищевой ценности и верни ТОЛЬКО JSON без пояснений:
{"found": true, "name": "название продукта на русском", "brand": "производитель или пустая строка", "kcal": число ккал на 100 г, "p": белки г на 100 г, "f": жиры г на 100 г, "c": углеводы г на 100 г, "fib": клетчатка или 0, "sug": сахара или 0, "salt": соль г или 0, "portion_g": масса упаковки или порции в граммах или 100, "confidence": "high"|"low"}
Если значения указаны на порцию — пересчитай на 100 г. Если на фото нет таблицы, верни {"found": false}.`, [blob]);
    return d;
  },
  /* Почему фото/AI недоступно — понятным языком */
  whyOff() {
    if (Store.backend === 'supa' && !Supa.user) return 'Распознавание работает после входа в аккаунт. Войдите в «Профиле» — это бесплатно.';
    if (!IN_FRAME && Store.backend !== 'supa') return 'Распознавание работает после входа в аккаунт FORMA (Профиль → «Войти»).';
    return 'Распознавание фото недоступно в этом окне — нет доступа к AI.';
  },
  errText(e) {
    const c = e && e.code;
    if (c === 'not_granted') return 'Доступ к AI не разрешён для этой страницы.';
    if (c === 'rate_limited' || c === 'busy') return 'AI сейчас занят — попробуйте через минуту.';
    if (c === 'limit') return e && e.premium ? `На сегодня лимит AI исчерпан (${e.limit} в день). Завтра снова можно.` : `Бесплатно — ${(e && e.limit) || 3} AI-распознавания в день, на сегодня они закончились. С Premium — 50 в день (раздел «Ещё → Premium»), или добавьте еду через поиск.`;
    if (c === 'premium_required') return 'Эта функция доступна в Premium (раздел «Ещё → Premium»).';
    if (c === 'not_configured') return 'Распознавание по фото ещё не включено на сервере (не задан ключ AI). Добавьте еду через поиск или штрихкод.';
    if (c === 'auth') return 'Войдите в аккаунт заново, чтобы пользоваться распознаванием.';
    if (c === 'offline') return 'Нет интернета — распознавание недоступно. Добавьте еду через поиск: база работает без сети.';
    if (c === 'refused') return 'AI не смог обработать это фото. Попробуйте другой снимок.';
    if (c === 'no_images') return 'Распознавание фото здесь недоступно.';
    return 'AI не ответил: ' + ((e && e.message) || 'попробуйте ещё раз');
  },
};
function blobToB64(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(new Error('Не удалось прочитать фото')); r.readAsDataURL(blob); });
}
function parseJSONLoose(t) { const m = String(t || '').match(/[\[{][\s\S]*[\]}]/); if (!m) throw new Error('AI вернул не JSON'); return JSON.parse(m[0]); }
async function shrinkImage(file, max = 1280) {
  const bmp = await createImageBitmap(file); const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob((b) => res(b), 'image/jpeg', 0.85));
}

/* Распознавание еды по фото с проверкой и правкой результата */
ACT.aiPhoto = (el) => {
  const date = el.dataset.date || App.diaryDate; const meal = el.dataset.meal || autoMeal();
  if (!AI.photo) { aiOffSheet('Еда по фото'); return; }
  const s = Sheet.open({ title: 'Еда по фото', wide: true, body: `<p class="muted">Сфотографируйте тарелку сверху при хорошем свете. AI определит блюда и примерное КБЖУ — вы проверите и поправите всё перед добавлением.</p>
    <div class="f2 mt12"><label>Вес порции, г<input class="input" data-k="grams" inputmode="decimal" placeholder="если знаете" maxlength="5"></label>
      <label>Что на тарелке<input class="input" data-k="hint" placeholder="напр.: плов" maxlength="120"></label></div>
    <p class="muted sm">Оба поля необязательные: с ними оценка точнее.</p>
    <div class="row gap8 wrap mt12"><label class="btn primary">${ic('camera', 18)}Сделать фото<input type="file" accept="image/*" capture="environment" hidden data-k="f"></label>
    <label class="btn">${ic('image', 18)}Из галереи<input type="file" accept="image/*" hidden data-k="f"></label></div><div data-k="out" class="mt16"></div>` });
  s.querySelectorAll('[data-k=f]').forEach((inp) => { inp.onchange = async () => {
    const file = inp.files[0]; inp.value = ''; if (!file) return; const out = s.querySelector('[data-k=out]');
    const gIn = s.querySelector('[data-k=grams]'); const grams = num(gIn.value);
    if (gIn.value.trim() && !(grams > 0 && grams <= 5000)) { markInvalid(gIn, 'Вес порции — от 1 до 5000 г (или оставьте пустым)'); return; }
    const url = URL.createObjectURL(file);
    out.innerHTML = `<img src="${url}" class="photo-prev" alt="Фото еды"><div class="loading mt12">${ic('spark', 20)}Анализирую фото… обычно 5–15 секунд</div>`;
    try {
      const blob = await shrinkImage(file, 1280);
      const data = await AI.task('photo', { blob, grams: grams > 0 ? grams : null, hint: s.querySelector('[data-k=hint]').value.trim() });
      aiItemsEditor(out, data, { date, meal, img: url, brand: 'Оценка по фото', totalGrams: grams > 0 ? grams : null });
    } catch (e) { console.warn(e); out.innerHTML = `<img src="${url}" class="photo-prev" alt=""><div class="banner warn mt12">${esc(AI.errText(e))}</div>`; }
  }; });
};
function aiOffSheet(title) {
  const login = Store.backend !== 'supa' && !IN_FRAME;
  Sheet.open({ title, body: `<p class="lead">${esc(AI.whyOff())}</p><p class="muted">А пока добавьте еду через поиск по базе или по штрихкоду.</p>${login ? '<button class="btn primary block mt12" data-act="signIn">Войти в аккаунт</button>' : ''}` });
}
/* Описание словами: «плов 300 г и чай с сахаром» → КБЖУ (любая кухня мира) */
ACT.aiText = (el) => {
  const date = el.dataset.date || App.diaryDate; const meal = el.dataset.meal || autoMeal();
  if (!AI.food) { aiOffSheet('Описать словами'); return; }
  const s = Sheet.open({ title: 'Описать словами', wide: true, body: `<p class="muted">Напишите, что съели — любое блюдо любой кухни или товар из магазина. AI оценит КБЖУ, вы проверите.</p>
    <form class="form mt12" data-k="f"><label>Что съели<input class="input" name="t" value="${esc(el.dataset.q || '')}" maxlength="200" placeholder="напр.: бешбармак 350 г и чай с сахаром"></label>
    <label>Общий вес, г<input class="input" name="g" inputmode="decimal" placeholder="необязательно"></label>
    <button class="btn primary block">${ic('spark', 18)}Оценить</button></form><div data-k="out" class="mt16"></div>` });
  const f = s.querySelector('[data-k=f]');
  f.onsubmit = async (e) => {
    e.preventDefault(); const text = f.t.value.trim(); const g = num(f.g.value);
    if (text.length < 2) { markInvalid(f.t, 'Напишите, что вы съели'); return; }
    if (f.g.value.trim() && !(g > 0 && g <= 5000)) { markInvalid(f.g, 'Вес — от 1 до 5000 г'); return; }
    const out = s.querySelector('[data-k=out]'); const btn = f.querySelector('button'); btn.disabled = true;
    out.innerHTML = `<div class="loading">${ic('spark', 20)}Считаю…</div>`;
    try { const data = await AI.task('text', { text, grams: g > 0 ? g : null }); aiItemsEditor(out, data, { date, meal, brand: 'Оценка AI', totalGrams: g > 0 ? g : null }); }
    catch (err) { out.innerHTML = `<div class="banner warn">${esc(AI.errText(err))}</div>`; }
    btn.disabled = false;
  };
  setTimeout(() => f.t.focus(), 150);
};
/* Проверка и правка результата AI перед добавлением в дневник */
function aiItemsEditor(out, data, { date, meal, img = '', brand, totalGrams = null }) {
  const pic = img ? `<img src="${img}" class="photo-prev" alt="">` : '';
  const items = ((data && data.items) || []).filter((x) => x && x.name).slice(0, 12);
  if (!items.length) { out.innerHTML = `${pic}<div class="banner warn mt12">${esc((data && data.comment) || 'Не удалось распознать еду.')}</div>`; return; }
  const v = (x, d) => (Number.isFinite(+x) ? (d ? r1(x) : r0(x)) : '');
  out.innerHTML = `${pic}
    <div class="banner info mt12">${ic('info', 18)}<div>Это примерная оценка AI${data.comment ? ': ' + esc(data.comment) : ''}. Проверьте названия и граммы — значения ккал и БЖУ указаны на 100 г.</div></div>
    <div class="ai-items">${items.map((x, i) => `<div class="ai-it" data-i="${i}"><label class="chk-l"><input type="checkbox" checked data-f="on" aria-label="Добавить"><input class="input" data-f="name" value="${esc(x.name)}" maxlength="80"></label>
      <div class="f5 tight"><label>Граммы<input class="input" data-f="grams" inputmode="decimal" value="${v(x.grams)}"></label><label>ккал/100 г<input class="input" data-f="kcal" inputmode="decimal" value="${v(x.kcal)}"></label>
      <label>Б<input class="input" data-f="p" inputmode="decimal" value="${v(x.p, 1)}"></label><label>Ж<input class="input" data-f="f" inputmode="decimal" value="${v(x.f, 1)}"></label><label>У<input class="input" data-f="c" inputmode="decimal" value="${v(x.c, 1)}"></label></div>
      <input type="hidden" data-f="fib" value="${v(x.fib, 1) || 0}"></div>`).join('')}</div>
    <div class="ai-total"><label>Общий вес, г<input class="input" data-k="total" inputmode="decimal" placeholder="—"></label><small class="muted">Взвесили еду? Впишите общий вес — граммы пересчитаются пропорционально.</small></div>
    <div class="preview" data-k="sum"></div>
    <label class="form">Приём пищи<select class="input" data-k="meal">${MEALS.map((m) => `<option value="${m.id}" ${m.id === meal ? 'selected' : ''}>${m.name}</option>`).join('')}</select></label>
    <button class="btn primary block mt12" data-k="add">${ic('plus', 18)}Добавить выбранное в дневник</button>`;
  const read = () => [...out.querySelectorAll('.ai-it')].map((row) => { const g = (f) => row.querySelector(`[data-f=${f}]`); return { on: g('on').checked, name: g('name').value.trim(), grams: num(g('grams').value), per: { kcal: num(g('kcal').value), p: num(g('p').value), f: num(g('f').value), c: num(g('c').value), fib: num(g('fib').value) || 0, sug: 0, salt: 0 }, row }; });
  const totalIn = out.querySelector('[data-k=total]');
  const sum = () => {
    const sel = read().filter((x) => x.on); const t = sel.reduce((a, x) => addN(a, scaleN(x.per, x.grams || 0)), zeroN());
    const g = sel.reduce((a, x) => a + (x.grams || 0), 0);
    if (document.activeElement !== totalIn) totalIn.value = g ? r0(g) : '';
    out.querySelector('[data-k=sum]').innerHTML = `<div class="pv-k"><b>${fmt(t.kcal)}</b><span>ккал</span></div><div><b>${fmt(t.p, 1)}</b><span>белки</span></div><div><b>${fmt(t.f, 1)}</b><span>жиры</span></div><div><b>${fmt(t.c, 1)}</b><span>углеводы</span></div>`;
  };
  totalIn.addEventListener('change', () => {
    const want = num(totalIn.value); const sel = read().filter((x) => x.on); const have = sel.reduce((a, x) => a + (x.grams || 0), 0);
    if (!(want > 0 && want <= 5000) || !have) { sum(); return; }
    sel.forEach((x) => { x.row.querySelector('[data-f=grams]').value = r0(x.grams * want / have); }); sum();
  });
  out.addEventListener('input', (e) => { if (e.target !== totalIn) sum(); });
  out.addEventListener('change', (e) => { if (e.target.dataset.f === 'on') sum(); });
  if (totalGrams) { const have = items.reduce((a, x) => a + (+x.grams || 0), 0); if (have && Math.abs(have - totalGrams) > 2) { totalIn.value = totalGrams; totalIn.dispatchEvent(new Event('change')); } }
  sum();
  out.querySelector('[data-k=add]').onclick = () => {
    const list = read().filter((x) => x.on); if (!list.length) { toast('Ничего не выбрано', 'warn'); return; }
    out.querySelectorAll('.ai-it').forEach((r) => r.classList.remove('invalid'));
    for (const x of list) {
      const bad = !x.name || !(x.grams > 0 && x.grams <= 5000) || ['kcal', 'p', 'f', 'c'].some((k) => !(x.per[k] >= 0 && x.per[k] <= (k === 'kcal' ? 950 : 100)));
      if (bad) { x.row.classList.add('invalid'); x.row.scrollIntoView({ block: 'center', behavior: 'smooth' }); toast('Проверьте выделенную строку: граммы 1–5000, ккал 0–950, БЖУ 0–100', 'err'); return; }
    }
    const m = out.querySelector('[data-k=meal]').value;
    list.forEach((x) => addToDiary(date, m, { id: 'ai_' + uid(), name: x.name, brand, per: x.per }, r1(x.grams)));
    Sheet.closeAll(); if (App.page === 'diary') App.diaryDate = date; render(); toast(`Добавлено в «${MEALS.find((mm) => mm.id === m).name}»: ${list.length} шт.`);
  };
}

/* ---------- AI-помощник по питанию (чат) ---------- */
App.chat = [];
function aiContext() {
  const P = D.profile || {}; const T = targets(); const t0 = todayISO(); const today = dayTotals(getDay(t0));
  const days = rangeDays(addDays(t0, -7), addDays(t0, -1)).filter((d) => D.days[d] && dayHasFood(D.days[d]));
  const avg = days.reduce((a, d) => addN(a, dayTotals(D.days[d])), zeroN()); if (days.length) NK.forEach((k) => { avg[k] /= days.length; });
  const ws = [...D.weights.entries].sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-6).map((e) => `${e.date}: ${e.kg} кг`).join('; ');
  const wo = Object.values(D.workouts).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 5).map((w) => `${w.date} ${w.name} (${w.durationMin} мин)`).join('; ');
  const todayList = MEALS.map((m) => `${m.name}: ${(getDay(t0).meals[m.id] || []).map((it) => `${it.name} ${it.g} г`).join(', ') || '—'}`).join('\n');
  return `ДАННЫЕ ПОЛЬЗОВАТЕЛЯ (из приложения FORMA):
Возраст: ${P.age || 'не указан'}; пол: ${P.sex === 'f' ? 'женский' : P.sex === 'm' ? 'мужской' : 'не указан'}; рост ${curHeight()} см; вес ${curWeight()} кг; цель: ${GOALS[P.goal] || 'не указана'}.
Цели на день: ${T.kcal} ккал, Б ${T.p} г, Ж ${T.f} г, У ${T.c} г, клетчатка ${T.fib} г, вода ${T.water} мл.
Сегодня (${t0}) съедено: ${r0(today.kcal)} ккал, Б ${r0(today.p)}, Ж ${r0(today.f)}, У ${r0(today.c)}, клетчатка ${r0(today.fib)}.
${todayList}
Среднее за ${days.length} заполненных дн. из последних 7: ${days.length ? `${r0(avg.kcal)} ккал, Б ${r0(avg.p)}, Ж ${r0(avg.f)}, У ${r0(avg.c)}` : 'нет данных'}.
Вес (последние): ${ws || 'нет данных'}. Тренировки: ${wo || 'нет'}.`;
}
const AI_RULES = `Ты — AI-помощник по питанию и тренировкам в приложении FORMA. Отвечай по-русски, дружелюбно и по делу, коротко (до 180 слов), списками где уместно.
Правила: опирайся на данные пользователя ниже; давай практичные советы с конкретными продуктами и граммовками; не ставь диагнозов и не назначай лекарства; при симптомах или заболеваниях советуй обратиться к врачу.
Безопасность: не предлагай экстремальные диеты, голодание, калорийность ниже безопасной, «сушку» подросткам. Если пользователю меньше 18 — только мягкие изменения и совет обсудить питание со специалистом. Если видишь признаки расстройства пищевого поведения — мягко поддержи и предложи обратиться к специалисту. Не оценивай внешность и не делай выводов о здоровье только по весу.`;
PAGES.ai = {
  title: 'AI-помощник', icon: 'spark',
  render() {
    if (!AI.ok) return `<div class="pagehead"><div><h1>AI-помощник</h1></div></div>${emptyState('spark', 'AI недоступен в этом окне', 'Откройте приложение на claude.ai под своим аккаунтом — помощнику нужен доступ к Claude. Остальные функции работают без него.')}`;
    const sugg = ['Что съесть на ужин, чтобы добрать белок?', 'Разбери мой рацион за неделю', 'Идеи перекусов до 200 ккал', 'Как распределить БЖУ по приёмам пищи?', 'Составь меню на день под мои цели'];
    return `<div class="pagehead"><div><h1>AI-помощник</h1><p class="muted">Видит ваши цели, сегодняшний дневник, среднее за неделю, вес и тренировки. Переписка не сохраняется.</p></div>
      ${App.chat.length ? '<button class="btn ghost" data-act="chatClear">Очистить</button>' : ''}</div>
    <section class="card chat">
      <div class="msgs" id="msgs">${App.chat.length ? App.chat.map((m) => `<div class="msg ${m.role}">${m.role === 'assistant' ? mdLite(m.content) : esc(m.content)}</div>`).join('') : `<div class="empty sm">${ic('spark', 26)}<b>Спросите что угодно о питании</b><p>Например:</p></div>`}</div>
      ${!App.chat.length ? `<div class="chips">${sugg.map((x) => `<button class="chip" data-act="chatSugg">${esc(x)}</button>`).join('')}</div>` : ''}
      <form class="chat-in" data-sub="chatSend"><textarea class="input" name="q" rows="1" maxlength="1500" placeholder="Ваш вопрос…"></textarea><button class="icon-btn accent lg" aria-label="Отправить">${ic('send')}</button></form>
      <p class="muted sm">Советы AI — не медицинская рекомендация.</p>
    </section>`;
  },
  mount() { const m = $('#msgs'); if (m) m.scrollTop = m.scrollHeight; const t = $('.chat-in textarea'); if (t) t.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); t.form.requestSubmit(); } }); },
};
function mdLite(t) {
  return esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^#{1,4}\s*(.+)$/gm, '<b>$1</b>').replace(/^\s*[-•*]\s+(.+)$/gm, '<span class="li-dot">• $1</span>').replace(/\n/g, '<br>');
}
let chatAbort = null;
ACT.chatSugg = (el) => { const f = $('.chat-in'); f.q.value = el.textContent; f.requestSubmit(); };
ACT.chatClear = () => { if (chatAbort) chatAbort.abort(); App.chat = []; render(); };
ACT.chatSend = async (f) => {
  const q = f.q.value.trim(); if (!q || chatAbort) return;
  App.chat.push({ role: 'user', content: q }); App.chat.push({ role: 'assistant', content: '…' }); render();
  const msgs = App.chat.slice(0, -1).map((m, i) => ({ role: m.role, content: i === 0 ? `${AI_RULES}\n\n${aiContext()}\n\nВОПРОС: ${m.content}` : m.content }));
  if (msgs.length > 1) msgs[msgs.length - 1].content = `${aiContext()}\n\nВОПРОС: ${q}`;
  chatAbort = new AbortController();
  const bubble = () => { const all = $$('#msgs .msg.assistant'); return all[all.length - 1]; };
  try {
    const r = await AI.sample(msgs, { signal: chatAbort.signal, cache: false, onText: ({ text }) => { App.chat[App.chat.length - 1].content = text; const b = bubble(); if (b) { b.innerHTML = mdLite(text); const m = $('#msgs'); m.scrollTop = m.scrollHeight; } } });
    App.chat[App.chat.length - 1].content = r.text || '…';
  } catch (e) { App.chat[App.chat.length - 1].content = AI.errText(e); }
  chatAbort = null; if (App.page === 'ai') render();
};

/* ============================================================
   ПЛАНИРОВЩИК ПИТАНИЯ: меню на неделю, рецепты, покупки
   ============================================================ */
const PDAYS = [1, 2, 3, 4, 5, 6, 0]; // Пн..Вс (getDay)
function planDay(k) { D.plan.days['d' + k] = D.plan.days['d' + k] || { breakfast: [], lunch: [], dinner: [], snack: [] }; return D.plan.days['d' + k]; }
function planTotals(k) { const pd = D.plan.days['d' + k]; const t = zeroN(); if (!pd) return t; MEALS.forEach((m) => (pd[m.id] || []).forEach((it) => addN(t, itemN(it)))); return t; }
PAGES.planner = {
  title: 'Планировщик', icon: 'cal',
  render() {
    const tab = App.plannerTab;
    return `<div class="pagehead"><div><h1>Планировщик питания</h1><p class="muted">Меню на неделю, свои рецепты и автоматический список покупок.</p></div><button class="btn primary" data-act="aiMenu">${ic('spark', 18)}Меню на день от AI${Premium.active() ? '' : ' ✦'}</button></div>
      <div class="tabs big">${[['week', 'Меню на неделю'], ['recipes', 'Рецепты'], ['shop', 'Покупки']].map(([k, n]) => `<button class="tab ${k === tab ? 'on' : ''}" data-act="plTab" data-t="${k}">${n}</button>`).join('')}</div>
      <div class="fade">${this['tab_' + tab]()}</div>`;
  },
  tab_week() {
    const k = App.planDay; const pd = planDay(k); const t = planTotals(k); const T = targets();
    return `<div class="wdays">${PDAYS.map((d) => { const tt = planTotals(d); return `<button class="wday ${d === k ? 'on' : ''}" data-act="plDay" data-d="${d}"><b>${WD[d]}</b><small>${tt.kcal ? fmt(tt.kcal) : '—'}</small></button>`; }).join('')}</div>
      <section class="card sumcard"><div class="row between"><div><span class="muted">${WD_FULL[k]} · <span>план</span></span><div class="bignum">${fmt(t.kcal)}<small> / ${fmt(T.kcal)} ккал</small></div></div>
        <div class="row gap8 wrap"><button class="btn sm" data-act="plToDiary">${ic('book', 16)}В дневник</button><button class="btn sm ghost" data-act="plCopyDay">${ic('copy', 16)}Копировать</button><button class="btn sm ghost danger-t" data-act="plClear">${ic('trash', 16)}</button></div></div>
        ${Charts.bar(t.kcal, T.kcal)}<p class="muted sm mt8">Б ${fmt(t.p)}/${T.p} · Ж ${fmt(t.f)}/${T.f} · У ${fmt(t.c)}/${T.c} г</p></section>
      ${MEALS.map((m) => { const items = pd[m.id] || []; const mt = items.reduce((a, it) => addN(a, itemN(it)), zeroN()); return `<section class="card meal">
        <div class="card-h"><div><h3>${ic(m.icon, 18)}${m.name}</h3><small class="muted">${items.length ? fmt(mt.kcal) + ' ккал' : 'Пусто'}</small></div><button class="icon-btn accent" data-act="plAdd" data-meal="${m.id}" aria-label="Добавить">${ic('plus', 18)}</button></div>
        ${items.length ? `<div class="items">${items.map((it) => `<div class="item"><div class="grow"><b translate="no">${esc(it.name)}</b><small class="muted">${fmt(it.g)} г · ${fmt(itemN(it).kcal)} ккал${it.ref && it.ref.startsWith('r_') ? ' · блюдо' : ''}</small></div><button class="icon-btn" data-act="plRm" data-meal="${m.id}" data-id="${it.id}" aria-label="Убрать">${ic('x', 16)}</button></div>`).join('')}</div>` : ''}
      </section>`; }).join('')}`;
  },
  tab_recipes() {
    const L = Object.values(D.recipes).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    return `<div class="row gap8 mb12"><button class="btn primary" data-act="recNew">${ic('plus', 16)}Новый рецепт</button></div>
      ${L.length ? `<div class="grid g3">${L.map((r) => { const { n, grams } = recipeTotals(r); const sv = Math.max(1, r.servings || 1); return `
        <button class="card recipe" data-act="recOpen" data-id="${r.id}"><h3>${esc(r.name)}</h3><p class="muted sm">${r.ingredients.length} ингр. · ${sv} ${plural(sv, 'порция', 'порции', 'порций')} · ${fmt(grams / sv)} г</p>
          <div class="per100"><div><b>${fmt(n.kcal / sv)}</b><span>ккал/порц.</span></div><div><b>${fmt(n.p / sv)}</b><span>Б</span></div><div><b>${fmt(n.f / sv)}</b><span>Ж</span></div><div><b>${fmt(n.c / sv)}</b><span>У</span></div></div></button>`; }).join('')}</div>`
        : emptyState('fork', 'Рецептов пока нет', 'Добавьте ингредиенты с граммовкой — КБЖУ блюда и порции посчитаются автоматически.', '<button class="btn primary" data-act="recNew">Создать рецепт</button>')}`;
  },
  tab_shop() {
    const list = shoppingList(); const groups = {};
    list.forEach((x) => { (groups[x.cat] = groups[x.cat] || []).push(x); });
    const done = list.filter((x) => D.plan.shop[x.key]).length;
    return list.length ? `<section class="card"><div class="card-h"><h3>${ic('cart', 18)}Список покупок на неделю</h3><span class="muted sm">${done}/${list.length}</span></div>
      <p class="muted sm">Собран из меню на неделю; блюда разложены на ингредиенты. Сухие крупы указаны в сухом виде.</p>
      ${Object.entries(groups).map(([c, items]) => `<h4 class="mt12">${esc(FOOD_CATS[c] || 'Другое')}</h4><div class="list">${items.map((x) => `<label class="li shop ${D.plan.shop[x.key] ? 'done' : ''}"><input type="checkbox" data-ch="shopTick" data-k="${esc(x.key)}" ${D.plan.shop[x.key] ? 'checked' : ''}><span class="grow" translate="no">${esc(x.name)}</span><b>${x.g >= 1000 ? fmt(x.g / 1000, 2) + ' кг' : fmt(x.g) + ' г'}</b></label>`).join('')}</div>`).join('')}
      <div class="row gap8 wrap mt16"><button class="btn" data-act="shopCopy">${ic('copy', 16)}Копировать список</button><button class="btn ghost" data-act="shopReset">Снять отметки</button></div></section>`
      : emptyState('cart', 'Список пуст', 'Составьте меню во вкладке «Меню на неделю» — список покупок соберётся сам.');
  },
};
function shoppingList() {
  const agg = {};
  const add = (ref, name, g) => {
    const f = findFood(ref); const key = ref && !ref.startsWith('q_') && !ref.startsWith('ai_') ? ref : 'n:' + norm(name);
    agg[key] = agg[key] || { key, name: f ? f.name : name, g: 0, cat: f ? f.cat : 'custom' }; agg[key].g += g;
  };
  PDAYS.forEach((d) => { const pd = D.plan.days['d' + d]; if (!pd) return; MEALS.forEach((m) => (pd[m.id] || []).forEach((it) => {
    if (it.ref && it.ref.startsWith('r_')) {
      const r = D.recipes[it.ref.slice(2)]; if (!r) { add(it.ref, it.name, it.g); return; }
      const { grams } = recipeTotals(r); const k = grams > 0 ? it.g / grams : 0;
      r.ingredients.forEach((ing) => add(ing.ref, ing.name, ing.g * k));
    } else add(it.ref, it.name, it.g);
  })); });
  return Object.values(agg).map((x) => Object.assign(x, { g: Math.ceil(x.g / 5) * 5 })).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}
ACT.plTab = (el) => { App.plannerTab = el.dataset.t; render(); };
ACT.plDay = (el) => { App.planDay = +el.dataset.d; render(); };
ACT.plAdd = (el) => {
  const meal = el.dataset.meal; const k = App.planDay;
  openFoodPicker({ mode: 'plan', meal, title: `План: ${WD_FULL[k]}, ${MEALS.find((m) => m.id === meal).name.toLowerCase()}`, onDone: (food, g) => {
    planDay(k)[meal].push({ id: uid(), ref: food.id, name: food.name, g, per: clone(food.per) }); persist('plan'); render(); toast('Добавлено в план');
  } });
};
ACT.plRm = (el) => { const pd = planDay(App.planDay); pd[el.dataset.meal] = pd[el.dataset.meal].filter((x) => x.id !== el.dataset.id); persist('plan'); render(); };
ACT.plClear = async () => { if (!(await confirmDlg(`Очистить план на ${WD_FULL[App.planDay].toLowerCase()}?`))) return; delete D.plan.days['d' + App.planDay]; persist('plan'); render(); };
ACT.plCopyDay = () => {
  const s = Sheet.open({ title: 'Копировать план дня', body: `<p class="muted">Скопировать ${WD_FULL[App.planDay].toLowerCase()} на:</p><div class="wdays">${PDAYS.filter((d) => d !== App.planDay).map((d) => `<button class="wday" data-d="${d}"><b>${WD[d]}</b></button>`).join('')}</div>` });
  s.querySelectorAll('[data-d]').forEach((b) => { b.onclick = () => { D.plan.days['d' + b.dataset.d] = JSON.parse(JSON.stringify(planDay(App.planDay)), (k, v) => (k === 'id' ? uid() : v)); persist('plan'); Sheet.close(); toast('Скопировано на ' + WD_FULL[b.dataset.d].toLowerCase()); render(); }; });
};
ACT.plToDiary = () => {
  const pd = planDay(App.planDay); if (!MEALS.some((m) => pd[m.id].length)) { toast('План на этот день пуст', 'warn'); return; }
  // ближайшая дата с этим днём недели
  let d = todayISO(); while (parseISO(d).getDay() !== App.planDay) d = addDays(d, 1);
  const s = Sheet.open({ title: 'Перенести план в дневник', body: `<form class="form" data-k="f"><label>Дата<input class="input" type="date" name="d" value="${d}"></label><p class="muted sm">Продукты добавятся к уже записанным.</p><button class="btn primary block">Перенести</button></form>` });
  s.querySelector('[data-k=f]').onsubmit = (e) => { e.preventDefault(); const to = e.target.d.value; if (!to) return; const day = ensureDay(to);
    MEALS.forEach((m) => pd[m.id].forEach((it) => day.meals[m.id].push(Object.assign(clone(it), { id: uid() })))); saveDay(to); Sheet.close(); toast('План перенесён в дневник на ' + fmtDate(to)); };
};
ACT.shopTick = (el) => { if (el.checked) D.plan.shop[el.dataset.k] = true; else delete D.plan.shop[el.dataset.k]; persist('plan'); el.closest('.li').classList.toggle('done', el.checked); };
ACT.shopReset = () => { D.plan.shop = {}; persist('plan'); render(); };
ACT.shopCopy = () => copyText('Список покупок (FORMA)\n' + shoppingList().map((x) => `${D.plan.shop[x.key] ? '✓' : '□'} ${x.name} — ${x.g >= 1000 ? fmt(x.g / 1000, 2) + ' кг' : fmt(x.g) + ' г'}`).join('\n'), 'Список скопирован');

/* Рецепты */
ACT.recNew = () => openRecipeEditor({ name: '', servings: 2, ingredients: [] });
ACT.recOpen = (el) => openRecipeView(el.dataset.id);
function openRecipeView(id) {
  const r = D.recipes[id]; if (!r) return; const { n, grams } = recipeTotals(r); const sv = Math.max(1, r.servings || 1); let k = sv;
  const s = Sheet.open({ title: r.name, wide: true, body: `<div class="row between wrap gap8"><span class="muted">${fmt(grams)} г всего · ${sv} ${plural(sv, 'порция', 'порции', 'порций')} по ${fmt(grams / sv)} г</span>
      <span class="row gap8 center">Порций:<button class="icon-btn soft" data-k="m">${ic('minus', 16)}</button><b data-k="sv">${k}</b><button class="icon-btn soft" data-k="p">${ic('plus', 16)}</button></span></div>
    <div data-k="ing" class="mt12"></div>
    <div class="split mt12"><div><h4>Всё блюдо (${sv} порц.)</h4>${nutrTable(n, 100)}</div><div><h4>1 порция</h4>${nutrTable(scaleN(n, 100 / sv), 100)}</div></div>
    ${r.notes ? `<h4>Заметки</h4><p>${esc(r.notes)}</p>` : ''}`,
    foot: `<button class="icon-btn danger-t" data-k="del" aria-label="Удалить">${ic('trash')}</button><button class="icon-btn" data-k="qr" aria-label="QR-код">${ic('qr')}</button><button class="icon-btn" data-k="edit" aria-label="Изменить">${ic('edit')}</button><button class="btn primary grow" data-k="add">В дневник</button>` });
  const drawIng = () => { s.querySelector('[data-k=sv]').textContent = k; s.querySelector('[data-k=ing]').innerHTML = `<table class="ntable">${r.ingredients.map((i) => `<tr><td translate="no">${esc(i.name)}</td><td>${fmt(i.g * k / sv)} г</td></tr>`).join('')}</table>${k !== sv ? `<p class="muted sm">Граммовка пересчитана на ${k} ${plural(k, 'порцию', 'порции', 'порций')}.</p>` : ''}`; };
  s.querySelector('[data-k=m]').onclick = () => { k = Math.max(1, k - 1); drawIng(); };
  s.querySelector('[data-k=p]').onclick = () => { k = Math.min(50, k + 1); drawIng(); };
  drawIng();
  s.querySelector('[data-k=add]').onclick = () => openAmount(recipeAsFood(r), { date: App.page === 'diary' ? App.diaryDate : todayISO(), meal: autoMeal() });
  s.querySelector('[data-k=edit]').onclick = () => { Sheet.close(); openRecipeEditor(clone(r)); };
  s.querySelector('[data-k=qr]').onclick = () => showQR('recipe-' + r.id, r.name);
  s.querySelector('[data-k=del]').onclick = async () => { Sheet.close(); if (!(await confirmDlg(`Удалить рецепт «${r.name}»?`))) return; delete D.recipes[id]; persist('recipe-' + id); invalidateFoods(); render(); };
}
function openRecipeEditor(rec) {
  const R = clone(rec); R.ingredients = R.ingredients || [];
  const s = Sheet.open({ title: R.id ? 'Редактировать рецепт' : 'Новый рецепт', wide: true,
    body: `<div class="form"><label>Название*<input class="input" data-k="name" value="${esc(R.name || '')}" maxlength="80" placeholder="Например: Сырники из творога"></label>
      <div class="f2"><label>Порций<input class="input" data-k="sv" inputmode="numeric" value="${R.servings || 1}"></label><div></div></div></div>
      <h4 class="mt12">Ингредиенты</h4><div data-k="ing"></div><button class="btn block mt8" data-k="add">${ic('plus', 16)}Добавить ингредиент</button>
      <div class="calc-res mt12" data-k="tot"></div>
      <label class="form mt12">Заметки / способ приготовления<textarea class="input" data-k="notes" rows="3" maxlength="1500">${esc(R.notes || '')}</textarea></label>`,
    foot: `<button class="btn primary grow" data-k="save">Сохранить рецепт</button>` });
  const draw = () => {
    s.querySelector('[data-k=ing]').innerHTML = R.ingredients.length ? R.ingredients.map((i, idx) => `<div class="ing-row" data-i="${idx}"><span class="grow"><span translate="no">${esc(i.name)}</span><small class="muted"> · ${fmt(i.per.kcal)} ккал/100 г</small></span><label class="g-in"><input class="input" data-f="g" inputmode="decimal" value="${i.g}"><span>г</span></label><button class="icon-btn sm danger-t" data-rm aria-label="Убрать">${ic('x', 16)}</button></div>`).join('') : '<p class="muted">Добавьте ингредиенты и их массу.</p>';
    tot();
  };
  const tot = () => { const { n, grams } = recipeTotals(R); const sv = Math.max(1, num(s.querySelector('[data-k=sv]').value) || 1);
    s.querySelector('[data-k=tot]').innerHTML = R.ingredients.length ? `<div class="kpis k3"><div><span class="muted">Всё блюдо</span><b>${fmt(n.kcal)} ккал</b><small class="muted">${fmt(grams)} г</small></div><div class="acc"><span>1 порция</span><b>${fmt(n.kcal / sv)} ккал</b><small>${fmt(grams / sv)} г</small></div><div><span class="muted">На 100 г</span><b>${fmt(grams ? n.kcal / grams * 100 : 0)} ккал</b></div></div>
      <p class="muted sm">Порция: Б ${fmt(n.p / sv, 1)} · Ж ${fmt(n.f / sv, 1)} · У ${fmt(n.c / sv, 1)} г</p>` : ''; };
  draw();
  s.querySelector('[data-k=sv]').addEventListener('input', tot);
  const ing = s.querySelector('[data-k=ing]');
  ing.addEventListener('input', (e) => { const inp = e.target.closest('[data-f]'); if (!inp) return; const v = num(inp.value); inp.classList.toggle('invalid', !(v > 0 && v <= 10000)); R.ingredients[+inp.closest('[data-i]').dataset.i].g = Number.isFinite(v) ? v : 0; tot(); });
  ing.addEventListener('click', (e) => { if (e.target.closest('[data-rm]')) { R.ingredients.splice(+e.target.closest('[data-i]').dataset.i, 1); draw(); } });
  s.querySelector('[data-k=add]').onclick = () => openFoodPicker({ mode: 'recipe', title: 'Ингредиент', exclude: R.id ? 'r_' + R.id : null, onDone: (food, g) => { R.ingredients.push({ ref: food.id, name: food.name, g, per: clone(food.per) }); draw(); } });
  s.querySelector('[data-k=save]').onclick = () => {
    const nameEl = s.querySelector('[data-k=name]'); R.name = nameEl.value.trim(); if (!R.name) { markInvalid(nameEl, 'Введите название рецепта'); return; }
    const svEl = s.querySelector('[data-k=sv]'); const sv = num(svEl.value); if (!(sv >= 1 && sv <= 50 && Number.isInteger(sv))) { markInvalid(svEl, 'Порций: целое число от 1 до 50'); return; }
    if (!R.ingredients.length) { toast('Добавьте хотя бы один ингредиент', 'err'); return; }
    if (R.ingredients.some((i) => !(i.g > 0 && i.g <= 10000))) { toast('Проверьте массу ингредиентов (1–10000 г)', 'err'); return; }
    R.servings = sv; R.notes = s.querySelector('[data-k=notes]').value.trim(); R.kind = 'recipe'; R.id = R.id || uid(); R.updated = Date.now();
    D.recipes[R.id] = R; persist('recipe-' + R.id); invalidateFoods(); Sheet.close(); App.plannerTab = 'recipes'; if (App.page !== 'diary') go('planner'); else render(); toast('Рецепт сохранён');
  };
}

/* ============================================================
   СТАТИСТИКА И АНАЛИТИКА
   ============================================================ */
function periodRange() {
  const t = todayISO();
  if (App.statsRange === 'custom' && App.statsFrom && App.statsTo) return [App.statsFrom, App.statsTo];
  return [addDays(t, -(+App.statsRange || 30) + 1), t];
}
function periodStats(from, to) {
  const days = rangeDays(from, to); const logged = days.filter((d) => D.days[d] && dayHasFood(D.days[d]));
  const sum = logged.reduce((a, d) => addN(a, dayTotals(D.days[d])), zeroN()); const avg = zeroN(); if (logged.length) NK.forEach((k) => { avg[k] = sum[k] / logged.length; });
  const water = days.reduce((s, d) => s + dayWater(D.days[d]), 0) / days.length;
  const wos = Object.values(D.workouts).filter((w) => w.date >= from && w.date <= to);
  const ws = D.weights.entries.filter((e) => e.date >= from && e.date <= to).sort((a, b) => (a.date < b.date ? -1 : 1));
  const T = targets(); const inRange = logged.filter((d) => { const k = dayTotals(D.days[d]).kcal; return k >= T.kcal * 0.9 && k <= T.kcal * 1.1; }).length;
  return { days, logged, avg, water, wos, ws, wDelta: ws.length > 1 ? ws[ws.length - 1].kg - ws[0].kg : null, perWeek: wos.length / (days.length / 7), inRange };
}
PAGES.stats = {
  title: 'Аналитика', icon: 'chart',
  render() {
    const [from, to] = periodRange(); const S = periodStats(from, to); const len = S.days.length;
    const P = periodStats(addDays(from, -len), addDays(from, -1)); const T = targets();
    const delta = (a, b, d = 0, u = '') => { const x = a - b; if (!Number.isFinite(x) || (!a && !b) || (!P.logged.length && !P.wos.length)) return '<span class="muted">—</span>'; return `<span class="delta">${x > 0 ? '+' : ''}${fmt(x, d)}${u}</span>`; };
    return `<div class="pagehead"><div><h1>Статистика и аналитика</h1><p class="muted">${fmtDate(from, { full: true })} — ${fmtDate(to, { full: true })} · <span>заполнено ${S.logged.length} из ${len} дн.</span></p></div>
      <div class="row gap8"><button class="btn" data-act="exportCSV">${ic('download', 16)}CSV</button><button class="btn ghost" data-act="exportJSON">${ic('download', 16)}Резервная копия</button></div></div>
    <div class="row gap8 wrap center mb12"><div class="seg">${[[7, '7 дн'], [14, '14 дн'], [30, '30 дн'], [90, '90 дн'], ['custom', 'Период']].map(([v, n]) => `<button class="${String(App.statsRange) === String(v) ? 'on' : ''}" data-act="stRange" data-v="${v}">${n}${(v === 'custom' || v > 30) && !Premium.active() ? ' ✦' : ''}</button>`).join('')}</div>
      ${App.statsRange === 'custom' ? `<form class="row gap8 center" data-sub="stCustom"><input class="input sm" type="date" name="a" value="${from}"><span>—</span><input class="input sm" type="date" name="b" value="${to}" max="${todayISO()}"><button class="btn sm">OK</button></form>` : ''}</div>
    <div class="kpis big">
      <div><span class="muted">Ср. калорийность</span><b>${S.logged.length ? fmt(S.avg.kcal) : '—'}</b><small>цель ${fmt(T.kcal)}</small></div>
      <div><span class="muted">Ср. белки</span><b>${S.logged.length ? fmt(S.avg.p) + ' г' : '—'}</b><small>цель ${T.p} г</small></div>
      <div><span class="muted">Ср. жиры</span><b>${S.logged.length ? fmt(S.avg.f) + ' г' : '—'}</b><small>цель ${T.f} г</small></div>
      <div><span class="muted">Ср. углеводы</span><b>${S.logged.length ? fmt(S.avg.c) + ' г' : '—'}</b><small>цель ${T.c} г</small></div>
      <div><span class="muted">Тренировок</span><b>${S.wos.length}</b><small>${fmt(S.perWeek, 1)} в неделю</small></div>
      <div><span class="muted">Вода в день</span><b>${fmt(S.water / 1000, 1)} л</b><small>цель ${fmt(T.water / 1000, 1)} л</small></div>
      <div><span class="muted">Динамика веса</span><b>${S.wDelta == null ? '—' : (S.wDelta > 0 ? '+' : '') + fmt(S.wDelta, 1) + ' кг'}</b><small>${S.ws.length} измерений</small></div>
      <div><span class="muted">Дней в норме ±10%</span><b>${S.inRange}/${S.logged.length}</b><small>по калориям</small></div>
    </div>
    <div class="grid g2">
      <section class="card"><div class="card-h"><h3>Калории по дням</h3></div><div class="chart-box" id="stK"></div></section>
      <section class="card"><div class="card-h"><h3>Энергия из БЖУ, ккал</h3></div><div class="chart-box" id="stM"></div>
        <div class="legend"><span><i style="background:var(--cp)"></i>Белки</span><span><i style="background:var(--cf)"></i>Жиры</span><span><i style="background:var(--cc)"></i>Углеводы</span></div></section>
      <section class="card"><div class="card-h"><h3>Вес</h3></div><div class="chart-box" id="stW"></div></section>
      <section class="card"><div class="card-h"><h3>Вода, мл</h3></div><div class="chart-box" id="stH"></div></section>
      <section class="card"><div class="card-h"><h3>Частота тренировок (по неделям)</h3></div><div class="chart-box" id="stT"></div></section>
      <section class="card"><div class="card-h"><h3>Сравнение с прошлым периодом</h3><span class="muted sm">${len} дн. до</span></div>
        <table class="ntable cmp"><tr><th></th><th>Сейчас</th><th>Ранее</th><th>Δ</th></tr>
        <tr><td>Калории</td><td>${fmt(S.avg.kcal)}</td><td>${fmt(P.avg.kcal)}</td><td>${delta(S.avg.kcal, P.avg.kcal)}</td></tr>
        <tr><td>Белки, г</td><td>${fmt(S.avg.p)}</td><td>${fmt(P.avg.p)}</td><td>${delta(S.avg.p, P.avg.p)}</td></tr>
        <tr><td>Жиры, г</td><td>${fmt(S.avg.f)}</td><td>${fmt(P.avg.f)}</td><td>${delta(S.avg.f, P.avg.f)}</td></tr>
        <tr><td>Углеводы, г</td><td>${fmt(S.avg.c)}</td><td>${fmt(P.avg.c)}</td><td>${delta(S.avg.c, P.avg.c)}</td></tr>
        <tr><td>Клетчатка, г</td><td>${fmt(S.avg.fib)}</td><td>${fmt(P.avg.fib)}</td><td>${delta(S.avg.fib, P.avg.fib)}</td></tr>
        <tr><td>Вода, мл/день</td><td>${fmt(S.water)}</td><td>${fmt(P.water)}</td><td>${delta(S.water, P.water)}</td></tr>
        <tr><td>Тренировок</td><td>${S.wos.length}</td><td>${P.wos.length}</td><td>${delta(S.wos.length, P.wos.length)}</td></tr>
        <tr><td>Заполнено дней</td><td>${S.logged.length}</td><td>${P.logged.length}</td><td>${delta(S.logged.length, P.logged.length)}</td></tr></table>
        <p class="muted sm">Средние считаются только по дням с записями.</p></section>
    </div>
    <section class="card"><div class="card-h"><h3>${ic('book', 18)}История питания</h3><span class="muted sm">нажмите на день, чтобы открыть дневник</span></div>
      ${S.logged.length ? `<div class="tscroll"><table class="ntable hist"><tr><th>Дата</th><th>Ккал</th><th>Б</th><th>Ж</th><th>У</th><th>Клетч.</th><th>Вода</th></tr>
      ${[...S.logged].reverse().map((d) => { const t = dayTotals(D.days[d]); return `<tr data-act="openDiary" data-d="${d}"><td>${fmtDate(d)}</td><td class="${t.kcal > T.kcal * 1.1 ? 'over-t' : ''}">${fmt(t.kcal)}</td><td>${fmt(t.p)}</td><td>${fmt(t.f)}</td><td>${fmt(t.c)}</td><td>${fmt(t.fib)}</td><td>${fmt(dayWater(D.days[d]))}</td></tr>`; }).join('')}</table></div>`
        : '<p class="muted">В выбранном периоде нет записей.</p>'}</section>`;
  },
  mount() {
    const [from, to] = periodRange(); const days = rangeDays(from, to); const T = targets();
    const labels = days.map(fmtShort); const tips = days.map((d) => `${WD[parseISO(d).getDay()]}, ${fmtDate(d, { full: true })}`);
    const tot = days.map((d) => (D.days[d] && dayHasFood(D.days[d]) ? dayTotals(D.days[d]) : null));
    Charts.mount($('#stK'), (el) => Charts.bars(el, { labels, tipLabels: tips, values: tot.map((t) => (t ? r0(t.kcal) : 0)), target: T.kcal, unit: 'ккал' }));
    Charts.mount($('#stM'), (el) => Charts.bars(el, { labels, tipLabels: tips, unit: 'ккал', stacks: [
      { name: 'Белки', color: 'var(--cp)', values: tot.map((t) => (t ? r0(t.p * 4) : 0)) }, { name: 'Жиры', color: 'var(--cf)', values: tot.map((t) => (t ? r0(t.f * 9) : 0)) }, { name: 'Углеводы', color: 'var(--cc)', values: tot.map((t) => (t ? r0(t.c * 4) : 0)) }] }));
    const wmap = Object.fromEntries(D.weights.entries.map((e) => [e.date, e.kg]));
    Charts.mount($('#stW'), (el) => Charts.line(el, { labels, tipLabels: tips, series: [{ name: 'Вес', values: days.map((d) => wmap[d] ?? null), color: 'var(--accent-ink)' }], unit: 'кг', decimals: 1, connect: true, target: D.profile && D.profile.goalWeight, empty: 'Нет измерений веса за период' }));
    Charts.mount($('#stH'), (el) => Charts.bars(el, { labels, tipLabels: tips, values: days.map((d) => (D.days[d] ? D.days[d].water : 0)), color: 'var(--cw)', target: T.water, unit: 'мл', empty: 'Нет записей воды' }));
    const weeks = []; for (let w = weekStart(from); w <= to; w = addDays(w, 7)) weeks.push(w);
    Charts.mount($('#stT'), (el) => Charts.bars(el, { labels: weeks.map(fmtShort), tipLabels: weeks.map((w) => 'Неделя с ' + fmtDate(w, { full: true })), values: weeks.map((w) => Object.values(D.workouts).filter((x) => x.date >= w && x.date <= addDays(w, 6)).length), color: 'var(--accent-ink)', unit: 'трен.', empty: 'Нет тренировок за период' }));
  },
};
ACT.stRange = (el) => { if ((el.dataset.v === 'custom' || +el.dataset.v > 30) && !requirePremium('Статистика за 90 дней и любой период')) return; App.statsRange = el.dataset.v === 'custom' ? 'custom' : +el.dataset.v; if (App.statsRange === 'custom' && !App.statsFrom) { App.statsFrom = addDays(todayISO(), -29); App.statsTo = todayISO(); } render(); };
ACT.stCustom = (f) => { const a = f.a.value, b = f.b.value; if (!a || !b || a > b) { toast('Проверьте даты: начало должно быть раньше конца', 'err'); return; } if (diffDays(a, b) > 730) { toast('Максимум — 2 года', 'err'); return; } App.statsFrom = a; App.statsTo = b; render(); };
ACT.openDiary = (el) => { App.diaryDate = el.dataset.d; go('diary'); };
ACT.exportCSV = () => {
  const [from, to] = periodRange(); const rows = [['Дата', 'Ккал', 'Белки', 'Жиры', 'Углеводы', 'Клетчатка', 'Сахара', 'Соль', 'Вода мл', 'Шаги', 'Вес кг', 'Тренировок']];
  const wmap = Object.fromEntries(D.weights.entries.map((e) => [e.date, e.kg]));
  rangeDays(from, to).forEach((d) => { const day = D.days[d]; const t = day ? dayTotals(day) : zeroN();
    rows.push([d, r0(t.kcal), r1(t.p), r1(t.f), r1(t.c), r1(t.fib), r1(t.sug), r1(t.salt), dayWater(day), day && day.steps != null ? day.steps : '', wmap[d] ?? '', workoutsOn(d).length]); });
  saveFile(`forma-${from}_${to}.csv`, '﻿' + rows.map((r) => r.join(';')).join('\n'), 'text/csv');
};
ACT.exportJSON = () => saveFile(`forma-backup-${todayISO()}.json`, JSON.stringify({ app: 'FORMA', version: 1, exported: new Date().toISOString(), docs: docsFromState() }, null, 1), 'application/json');

/* ============================================================
   ПРОФИЛЬ И НАСТРОЙКИ
   ============================================================ */
const ACCENTS = { lime: ['#c8f031', '#4f6b00'], orange: ['#ff6a2b', '#c2410c'], blue: ['#4c8dff', '#1d5fd6'], pink: ['#ff5c9d', '#c42a6a'], violet: ['#9b87ff', '#5b45d6'] };
function settings() { const s = (D.profile && D.profile.settings) || {}; return Object.assign({ theme: 'system', accent: 'lime', addBurned: false, stepsInBudget: true, rem: { on: false, meals: { breakfast: '08:00', lunch: '13:00', dinner: '19:00', snack: '' }, water: 0, from: '09:00', to: '21:00' } }, s); }
PAGES.profile = {
  title: 'Профиль', icon: 'user',
  render() {
    const P = D.profile || {}; const S = settings(); const T = targets();
    const acts = [];
    rangeDays(addDays(todayISO(), -30), todayISO()).reverse().forEach((d) => { getDay(d).activities.forEach((a) => acts.push({ d, t: a.name, s: `${a.min} мин · ${a.kcal} ккал` })); workoutsOn(d).forEach((w) => acts.push({ d, t: w.name, s: `тренировка · ${w.durationMin} мин` })); });
    const favs = D.meta.favorites.map(findFood).filter(Boolean);
    return `<div class="pagehead"><div><h1>Профиль</h1></div></div>
    <div class="grid g2">
      <section class="card">
        <div class="profile-h"><div class="avatar">${esc((P.name || '?').slice(0, 1).toUpperCase())}</div><div><h2>${esc(P.name || 'Без имени')} ${premBadge()}</h2>
          <p class="muted sm">${Store.backend === 'supa' ? `${ic('check', 14)} ${esc(Store.email || 'Аккаунт')} · данные в облаке` : Store.mode === 'cloud' ? `${ic('check', 14)} Вход через аккаунт Claude · данные в облаке, доступны только вам` : `Локальный режим · данные в этом браузере`}</p></div></div>
        ${typeof Supa !== 'undefined' && Supa.enabled ? `<div class="row gap8 wrap mt12">${Store.backend === 'supa' ? `<button class="btn sm" data-act="signOut">${ic('logout', 16)}Выйти</button>${Supa.isAdmin ? `<a class="btn sm" href="#admin">${ic('user', 16)}Пользователи</a>` : ''}` : `<button class="btn sm primary" data-act="signIn">${ic('user', 16)}Войти или создать аккаунт</button>`}<button class="btn sm ghost" data-act="privacy">Конфиденциальность</button></div>` : ''}
        ${Store.cloudNote ? `<div class="banner warn mt12">${ic('info', 18)}<div>${esc(Store.cloudNote)}</div></div>` : ''}
        <a href="#premium" class="prem-row mt12">${ic('spark', 18)}<div class="grow"><b>${Premium.active() ? 'FORMA Premium активен' : 'FORMA Premium'}</b><small class="muted">${Premium.active() && Premium.st.until ? 'до ' + new Date(Premium.st.until).toLocaleDateString('ru-RU') : 'AI 50 раз в день, меню от AI, полная статистика'}</small></div>${ic('right', 16)}</a>
        <form class="form mt16" data-sub="profileSave">
          <div class="f2"><label>Имя<input class="input" name="name" value="${esc(P.name || '')}" maxlength="40"></label><label>Возраст<input class="input" name="age" inputmode="numeric" value="${P.age || ''}"></label>
          <label>Пол<select class="input" name="sex"><option value="m" ${P.sex !== 'f' ? 'selected' : ''}>Мужской</option><option value="f" ${P.sex === 'f' ? 'selected' : ''}>Женский</option></select></label>
          <label>Рост, см<input class="input" name="height" inputmode="decimal" value="${curHeight()}"></label>
          <label>Активность<select class="input" name="activity">${ACT_LEVELS.map((a) => `<option value="${a.v}" ${(+P.activity || 1.375) === a.v ? 'selected' : ''}>${a.n}</option>`).join('')}</select></label>
          <label>Цель<select class="input" name="goal" data-ch="goalHint">${goalOptions(P.goal)}</select><small class="goal-hint muted">${goalHint(P.goal || 'maintain')}</small></label></div>
          <label class="switch"><input type="checkbox" name="recalc" ${P.targetsManual ? '' : 'checked'}><span></span>Пересчитать цели КБЖУ по новым данным</label>
          <button class="btn primary block">Сохранить профиль</button></form>
      </section>
      <section class="card">
        <div class="card-h"><h3>${ic('flame', 18)}Мои цели</h3><a class="link" href="#calc">Калькулятор</a></div>
        <div class="kpis k3"><div><span class="muted">Калории</span><b>${fmt(T.kcal)}</b></div><div><span class="muted">Белки</span><b>${T.p} г</b></div><div><span class="muted">Жиры</span><b>${T.f} г</b></div><div><span class="muted">Углеводы</span><b>${T.c} г</b></div><div><span class="muted">Вода</span><b>${fmt(T.water)} мл</b></div><div><span class="muted">Шаги</span><b>${fmt(T.steps)}</b></div></div>
        <h4 class="mt16">Язык</h4>
        ${I18N.pickerHTML()}
        ${I18N.lang !== 'ru' ? '<p class="muted sm mt8">Названия продуктов из базы остаются на русском.</p>' : ''}
        <h4 class="mt16">Оформление</h4>
        <div class="seg">${[['system', 'Как в системе'], ['light', 'Светлая'], ['dark', 'Тёмная']].map(([k, n]) => `<button class="${S.theme === k ? 'on' : ''}" data-act="setTheme" data-v="${k}">${n}</button>`).join('')}</div>
        <div class="swatches mt12">${Object.entries(ACCENTS).map(([k, [c]]) => `<button class="sw ${S.accent === k ? 'on' : ''}" style="background:${c}" data-act="setAccent" data-v="${k}" aria-label="Акцентный цвет ${k}"></button>`).join('')}</div>
        <label class="switch mt16"><input type="checkbox" data-ch="setStepsBudget" ${S.stepsInBudget !== false ? 'checked' : ''}><span></span>Учитывать шаги и бег в дневной норме</label>
        <label class="switch mt12"><input type="checkbox" data-ch="setBurned" ${S.addBurned ? 'checked' : ''}><span></span>Прибавлять тренировки и активность к норме</label>
      </section>
      <section class="card">
        <div class="card-h"><h3>${ic('bell', 18)}Напоминания</h3></div>
        <form class="form" data-sub="remSave">
          <label class="switch"><input type="checkbox" name="on" ${S.rem.on ? 'checked' : ''}><span></span>Включить напоминания</label>
          <div class="f4 tight">${MEALS.map((m) => `<label>${m.name}<input class="input" type="time" name="m_${m.id}" value="${S.rem.meals[m.id] || ''}"></label>`).join('')}</div>
          <div class="f3 tight"><label>Вода каждые<select class="input" name="water">${[[0, 'выкл.'], [60, '1 час'], [90, '1,5 часа'], [120, '2 часа']].map(([v, n]) => `<option value="${v}" ${+S.rem.water === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
            <label>С<input class="input" type="time" name="from" value="${S.rem.from}"></label><label>До<input class="input" type="time" name="to" value="${S.rem.to}"></label></div>
          <p class="muted sm">Напоминания приходят, пока FORMA открыта (вкладка может быть в фоне). Для напоминаний при закрытом приложении используйте будильники или напоминания телефона.</p>
          <div class="row gap8"><button class="btn primary grow">Сохранить</button><button type="button" class="btn ghost" data-act="remTest">Проверить</button></div></form>
      </section>
      <section class="card">
        <div class="card-h"><h3>${ic('clock', 18)}История активности (30 дн.)</h3></div>
        ${acts.length ? `<div class="list">${acts.slice(0, 12).map((a) => `<div class="li"><div class="grow"><b>${esc(a.t)}</b><small class="muted">${fmtDate(a.d)} · ${a.s}</small></div></div>`).join('')}</div>` : '<p class="muted">Пока нет активностей и тренировок.</p>'}
        <button class="btn sm mt12" data-act="actCal">${ic('cal', 16)}Календарь активности</button>
      </section>
      <section class="card">
        <div class="card-h"><h3>${ic('star', 18)}Любимые продукты</h3><span class="muted sm">${favs.length}</span></div>
        ${favs.length ? `<div class="list">${favs.slice(0, 10).map((f) => `<div class="li" data-act="foodOpen" data-id="${f.id}" role="button"><div class="grow"><b translate="no">${esc(f.name)}</b><small class="muted">${fmt(f.per.kcal)} ккал/100 г</small></div>${ic('right', 16, 'dim')}</div>`).join('')}</div>` : '<p class="muted">Отмечайте продукты звёздочкой при добавлении.</p>'}
        <div class="card-h mt16"><h3>${ic('fork', 18)}Сохранённые рецепты</h3><a class="link" href="#planner" data-act="toRecipes">Все</a></div>
        ${Object.values(D.recipes).length ? `<div class="list">${Object.values(D.recipes).slice(0, 8).map((r) => `<div class="li" data-act="recOpen" data-id="${r.id}" role="button"><div class="grow"><b>${esc(r.name)}</b></div>${ic('right', 16, 'dim')}</div>`).join('')}</div>` : '<p class="muted">Рецептов пока нет.</p>'}
      </section>
      <section class="card">
        <div class="card-h"><h3>${ic('db', 18)}Данные</h3></div>
        <div class="menu flat">
          <button data-act="exportJSON">${ic('download')}Экспорт всех данных (JSON)</button>
          <button data-act="exportCSV">${ic('download')}Экспорт статистики (CSV)</button>
          <label class="menu-btn">${ic('upload')}Импорт из резервной копии<input type="file" accept=".json,application/json" data-ch="importJSON" hidden></label>
          <button data-act="wipe" class="danger-t">${ic('trash')}Удалить все мои данные</button></div>
      </section>
    </div>`;
  },
};
ACT.toRecipes = () => { App.plannerTab = 'recipes'; go('planner'); };
ACT.actCal = () => openCalendar({ title: 'Календарь активности (ккал)', selected: todayISO(), mode: 'act', onPick: (d) => { App.diaryDate = d; go('diary'); } });
ACT.profileSave = validated((f) => {
  const name = readStr(f, 'name', { required: false, max: 40, label: 'Имя' });
  const age = readNum(f, 'age', { min: 10, max: 100, label: 'Возраст', int: true }); const h = readNum(f, 'height', { min: 100, max: 250, label: 'Рост' });
  const P = D.profile = Object.assign(D.profile || {}, { name, age, sex: f.sex.value, activity: +f.activity.value, goal: f.goal.value });
  if (Math.abs(curHeight() - h) > 0.4) { P.heights = (P.heights || []).filter((x) => x.date !== todayISO()); P.heights.push({ date: todayISO(), cm: r1(h) }); }
  if (f.recalc.checked) { const r = calcTargets({ sex: P.sex, age, height: h, weight: curWeight(), activity: P.activity, goal: P.goal, pace: P.pace }); P.goal = r.goal; P.targets = { kcal: r.kcal, p: r.p, f: r.f, c: r.c, fib: r.fib, water: r.water }; P.targetsManual = false; }
  persist('profile'); render(); toast('Профиль сохранён');
});
function setSetting(k, v) { D.profile = D.profile || {}; D.profile.settings = Object.assign(settings(), { [k]: v }); persist('profile'); applyTheme(); }
ACT.setTheme = (el) => { setSetting('theme', el.dataset.v); render(); };
ACT.setAccent = (el) => { if (el.dataset.v !== 'lime' && !requirePremium('Цветовые темы')) return; setSetting('accent', el.dataset.v); render(); };
ACT.setStepsBudget = (el) => { setSetting('stepsInBudget', el.checked); toast(el.checked ? `Шаги сверх обычного дня (${fmt(STEPS_BASE)}) и бег добавляются к норме` : 'Шаги не влияют на норму'); };
ACT.setBurned = (el) => { setSetting('addBurned', el.checked); toast(el.checked ? 'Сожжённые калории добавляются к норме' : 'Норма без учёта активности'); };
ACT.remSave = (f) => {
  const rem = { on: f.on.checked, meals: {}, water: +f.water.value, from: f.from.value || '09:00', to: f.to.value || '21:00' };
  MEALS.forEach((m) => { rem.meals[m.id] = f['m_' + m.id].value; });
  if (rem.from >= rem.to) { toast('Время «с» должно быть раньше «до»', 'err'); return; }
  setSetting('rem', rem); toast(rem.on ? 'Напоминания включены' : 'Напоминания выключены');
  if (Native.on) { NativeNotify.schedule(); return; }
  if (rem.on && 'Notification' in window && Notification.permission === 'default') { try { Notification.requestPermission().catch(() => {}); } catch (e) { /* в песочнице может быть недоступно */ } }
};
ACT.remTest = () => Reminders.fire('Так выглядит напоминание FORMA', 'test');
ACT.importJSON = async (el) => {
  const file = el.files && el.files[0]; el.value = ''; if (!file) return;
  try {
    const j = JSON.parse(await file.text()); if (!j || j.app !== 'FORMA' || !j.docs) throw new Error('Это не резервная копия FORMA');
    const keys = Object.keys(j.docs); if (!(await confirmDlg(`Импортировать ${keys.length} записей? Совпадающие дни, продукты и программы будут заменены.`, 'Импортировать', false))) return;
    hydrate(j.docs); keys.forEach((k) => Store.save(k, j.docs[k])); invalidateFoods(); applyTheme(); render(); toast('Данные импортированы');
  } catch (e) { toast('Ошибка импорта: ' + e.message, 'err'); }
};
ACT.wipe = async () => {
  if (!(await confirmDlg('Удалить ВСЕ ваши данные: дневник, вес, тренировки, продукты, рецепты и профиль? Это необратимо. Сначала можно сделать экспорт.', 'Удалить всё'))) return;
  Object.keys(docsFromState()).forEach((k) => Store.remove(k));
  Object.assign(D, { profile: null, meta: { favorites: [], recent: [] }, weights: { entries: [] }, programs: { list: [] }, exlib: { list: [] }, plan: { days: {}, shop: {} }, active: null, days: {}, foods: {}, recipes: {}, workouts: {} });
  invalidateFoods(); toast('Все данные удалены'); applyTheme(); render();
};

/* ============================================================
   ОНБОРДИНГ (первый запуск)
   ============================================================ */
function onboardingHTML() {
  const nm = (Store.me && Store.me.name) ? Store.me.name.split(' ')[0] : '';
  return `<div class="onb fade"><div class="onb-card card">
    <div class="logo big"><span class="logo-mark"></span>FORMA</div>
    ${I18N.pickerHTML()}
    <h1>Настроим под вас</h1><p class="muted">Эти данные нужны, чтобы рассчитать калории и БЖУ. Их можно изменить в любой момент.</p>
    <form class="form mt16" data-sub="onbSave">
      <label>Как вас зовут?<input class="input" name="name" maxlength="40" value="${esc(nm)}"></label>
      <div class="seg"><label><input type="radio" name="sex" value="m" checked><span>Мужской</span></label><label><input type="radio" name="sex" value="f"><span>Женский</span></label></div>
      <div class="f3"><label>Возраст<input class="input" name="age" inputmode="numeric"></label><label>Рост, см<input class="input" name="height" inputmode="decimal"></label><label>Вес, кг<input class="input" name="weight" inputmode="decimal"></label></div>
      <label>Активность<select class="input" name="activity">${ACT_LEVELS.map((a) => `<option value="${a.v}" ${a.v === 1.55 ? 'selected' : ''}>${a.n} — ${a.d}</option>`).join('')}</select></label>
      <label>Цель<select class="input" name="goal" data-ch="goalHint">${goalOptions('maintain')}</select><small class="goal-hint muted">${goalHint('maintain')}</small></label>
      <button class="btn primary block lg">Рассчитать и начать</button>
      <button type="button" class="btn ghost block" data-act="onbSkip">Пропустить — введу позже</button>
      <p class="muted sm">${Store.backend === 'supa' ? `Вы вошли как ${esc(Store.email || '')}. Данные сохраняются в облаке и доступны на всех ваших устройствах.` : Store.mode === 'cloud' ? 'Вы вошли через аккаунт Claude. Данные хранятся в вашем личном пространстве и недоступны другим людям.' : 'Данные будут храниться в этом браузере.'}</p>
    </form></div></div>`;
}
ACT.onbSave = validated((f) => {
  const name = readStr(f, 'name', { required: false, max: 40 });
  const age = readNum(f, 'age', { min: 10, max: 100, label: 'Возраст', int: true }); const height = readNum(f, 'height', { min: 100, max: 250, label: 'Рост' }); const weight = readNum(f, 'weight', { min: 25, max: 350, label: 'Вес' });
  const o = { sex: f.querySelector('[name=sex]:checked').value, age, height, weight, activity: +f.activity.value, goal: f.goal.value, pace: 0.15 };
  const r = calcTargets(o);
  D.profile = { kind: 'profile', name, sex: o.sex, age, activity: o.activity, goal: r.goal, pace: 0.15, created: Date.now(), heights: [{ date: todayISO(), cm: height }], height, weight,
    targets: { kcal: r.kcal, p: r.p, f: r.f, c: r.c, fib: r.fib, water: r.water }, stepsGoal: 8000, targetsManual: false, settings: settings() };
  persist('profile'); upsertWeight(todayISO(), r1(weight), '');
  if (!D.programs.list.length) { D.programs.list = PROGRAM_TEMPLATES.slice(0, 3).map((t) => ({ id: uid(), name: t.name, items: t.items.map(([ex, sets, reps, w, rest]) => ({ ex, sets, reps, w, rest })) })); persist('programs'); }
  if (document.activeElement) document.activeElement.blur(); render(); window.scrollTo(0, 0); toast(`Готово! Ваша норма — ${fmt(r.kcal)} ккал`);
  if (r.notes.length) setTimeout(() => go('calc'), 400);
});
ACT.onbSkip = () => { D.profile = { kind: 'profile', name: '', created: Date.now(), settings: settings() }; persist('profile'); render(); window.scrollTo(0, 0); };
