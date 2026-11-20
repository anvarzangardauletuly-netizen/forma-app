/* ============================================================
   FORMA — страницы: Сканер, Калькулятор КБЖУ, Вес, Тренировки
   ============================================================ */
'use strict';

/* ============================================================
   СКАНЕР ШТРИХКОДОВ И QR
   ============================================================ */
/* Источники данных по штрихкоду. Порядок = приоритет.
   Точка расширения: добавьте объект { name, lookup(code) → Food|null }. */
const BarcodeProviders = [
  {
    name: 'Мои продукты', status: 'ok',
    async lookup(code) { const f = Object.values(D.foods).find((x) => sameCode(x.barcode, code)); return f ? customAsFood(f) : null; },
  },
  {
    // Офлайн-база магазинных товаров (Open Food Facts: Казахстан и Россия) — работает без интернета
    name: 'База магазинов', status: 'ok',
    async lookup(code) { return StoreFoods.findCode(code); },
  },
  {
    // Open Food Facts — открытая мировая база штрихкодов. Работает там, где странице разрешены внешние запросы.
    // В окне claude.ai политика безопасности блокирует запросы к другим сайтам — тогда провайдер помечается недоступным.
    name: 'Open Food Facts', status: 'unknown',
    async lookup(code) {
      if (this.status === 'off') return null;
      if (navigator.onLine === false) { this.offline = true; return null; }
      this.offline = false;
      try {
        const r = await withTimeout(fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,product_name_ru,brands,nutriments,serving_quantity`), 7000);
        if (!r.ok) { this.status = 'ok'; return null; }
        const j = await r.json(); this.status = 'ok';
        if (!j || j.status !== 1 || !j.product) return null;
        const p = j.product; const n = p.nutriments || {};
        const kcal = n['energy-kcal_100g'] ?? (n['energy_100g'] ? n['energy_100g'] / 4.184 : null);
        if (kcal == null) return null;
        return { id: 'off_' + code, name: p.product_name_ru || p.product_name || 'Продукт ' + code, brand: (p.brands || '').split(',')[0].trim(), cat: 'custom', barcode: code,
          per: { kcal: r1(kcal), p: r1(n.proteins_100g || 0), f: r1(n.fat_100g || 0), c: r1(n.carbohydrates_100g || 0), fib: r1(n.fiber_100g || 0), sug: r1(n.sugars_100g || 0), salt: r1(n.salt_100g || 0) },
          portion: { g: +p.serving_quantity || 100, label: 'порция' }, external: 'Open Food Facts' };
      } catch (e) { this.status = 'off'; return null; }
    },
  },
];
function sameCode(a, b) { if (!a || !b) return false; const s = (x) => String(x).replace(/^0+/, ''); return s(a) === s(b); }
function validEAN(code) {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  const d = code.split('').map(Number); const check = d.pop(); let sum = 0;
  d.reverse().forEach((x, i) => { sum += x * (i % 2 === 0 ? 3 : 1); });
  return (10 - (sum % 10)) % 10 === check;
}

const Scan = {
  stream: null, raf: null, busy: false, detector: undefined,
  async getDetector() {
    if (this.detector !== undefined) return this.detector;
    this.detector = null;
    if ('BarcodeDetector' in window) {
      try {
        const sup = await BarcodeDetector.getSupportedFormats();
        const want = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'].filter((f) => sup.includes(f));
        if (want.length) this.detector = new BarcodeDetector({ formats: want });
      } catch (e) { /* нет поддержки */ }
    }
    return this.detector;
  },
  async zx() { return loadScript('https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js', 'ZXing'); },
  async decodeCanvas(canvas) {
    const det = await this.getDetector();
    if (det) { try { const r = await det.detect(canvas); if (r && r.length) return r[0].rawValue; } catch (e) { /* дальше ZXing */ } }
    const Z = await this.zx();
    const hints = new Map(); hints.set(Z.DecodeHintType.TRY_HARDER, true);
    hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E, Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.CODE_39, Z.BarcodeFormat.ITF, Z.BarcodeFormat.QR_CODE]);
    const reader = new Z.MultiFormatReader(); reader.setHints(hints);
    try { const lum = new Z.HTMLCanvasElementLuminanceSource(canvas); return reader.decode(new Z.BinaryBitmap(new Z.HybridBinarizer(lum))).getText(); }
    catch (e) { return null; }
  },
  async decodeFile(file) {
    const bmp = await createImageBitmap(file);
    for (const maxSide of [1400, 900, 2000]) {
      for (const rot of [0, 90]) {
        const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
        const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
        const c = document.createElement('canvas'); c.width = rot ? h : w; c.height = rot ? w : h;
        const ctx = c.getContext('2d');
        if (rot) { ctx.translate(h, 0); ctx.rotate(Math.PI / 2); }
        ctx.drawImage(bmp, 0, 0, w, h);
        const code = await this.decodeCanvas(c); if (code) return code;
      }
    }
    return null;
  },
  async startLive() {
    const box = $('#liveBox'); if (!box) return;
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('nomedia');
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
    } catch (e) {
      box.innerHTML = `<div class="banner warn">${ic('info', 18)}<div><b>Живая камера недоступна в этом окне.</b><br>Браузер не дал доступ к камере внутри встроенной страницы. Нажмите «Сфотографировать штрихкод» — на телефоне сразу откроется камера, и код распознается со снимка.</div></div>`;
      return;
    }
    box.innerHTML = `<div class="viewfinder"><video playsinline muted autoplay></video><div class="vf-frame"></div><div class="vf-line"></div></div><button class="btn block mt12" data-act="scanStop">Остановить камеру</button>`;
    const v = box.querySelector('video'); v.srcObject = this.stream; await v.play().catch(() => {});
    const c = document.createElement('canvas'); let last = 0;
    const loop = async (t) => {
      if (!this.stream) return;
      if (t - last > 280 && !this.busy && v.videoWidth) {
        last = t; this.busy = true;
        c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0);
        try { const code = await this.decodeCanvas(c); if (code) { this.stop(); if (navigator.vibrate) navigator.vibrate(60); handleCode(code); return; } } catch (e) { console.warn(e); }
        this.busy = false;
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  },
  stop() {
    if (this.raf) cancelAnimationFrame(this.raf); this.raf = null; this.busy = false;
    if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
    const box = $('#liveBox'); if (box) box.innerHTML = '';
  },
};

PAGES.scan = {
  title: 'Сканер', icon: 'scan',
  render() {
    const ctx = App.scanCtx; const off = BarcodeProviders[2].status;
    return `
    <div class="pagehead"><div><h1>Сканер штрихкодов</h1><p class="muted">${ctx ? `Добавление в «${MEALS.find((m) => m.id === ctx.meal).name}», ${fmtDate(ctx.date).toLowerCase()}` : 'Наведите камеру на штрихкод упаковки или QR-код FORMA'}</p></div></div>
    <section class="card scan-card">
      <div class="scan-actions">
        <label class="scan-btn primary">${ic('camera', 26)}<b>Сфотографировать штрихкод</b><small>Откроет камеру телефона</small><input type="file" accept="image/*" capture="environment" data-ch="scanFile" hidden></label>
        <button class="scan-btn" data-act="scanLive">${ic('scan', 26)}<b>Живое сканирование</b><small>Камера в реальном времени</small></button>
        <label class="scan-btn">${ic('image', 26)}<b>Из галереи</b><small>Готовый снимок упаковки</small><input type="file" accept="image/*" data-ch="scanFile" hidden></label>
      </div>
      <div id="liveBox"></div>
      <form class="row gap8 mt16" data-sub="scanManual"><input class="input grow" name="code" inputmode="numeric" placeholder="Или введите цифры штрихкода" maxlength="14"><button class="btn primary">Найти</button></form>
    </section>
    <div id="scanResult"></div>
    <section class="card subtle">
      <h4>Как это работает</h4>
      <ol class="steps-list"><li>Код распознаётся прямо на устройстве (EAN-13, EAN-8, UPC, Code 128, QR).</li>
      <li>Поиск: ваши продукты → база магазинов в приложении (${fmt(StoreFoods.list.length)} товаров, работает без интернета)${off === 'off' ? '' : ' → открытая база Open Food Facts в интернете'}.</li>
      <li>Нашёлся — укажите граммы и добавьте в дневник. Нет — создайте продукт вручную или сфотографируйте этикетку с КБЖУ, и AI заполнит форму для проверки. В следующий раз этот штрихкод найдётся сразу.</li></ol>
      ${off === 'off' ? '<p class="muted sm">Внешняя база штрихкодов недоступна из этого окна (браузер блокирует запросы к другим сайтам), поэтому поиск идёт по вашей базе продуктов.</p>' : ''}
    </section>`;
  },
  unmount() { Scan.stop(); },
};
ACT.scanLive = () => Scan.startLive();
ACT.scanStop = () => Scan.stop();
ACT.scanFile = async (el) => {
  const file = el.files && el.files[0]; el.value = ''; if (!file) return;
  const out = $('#scanResult'); out.innerHTML = `<section class="card"><div class="loading">${ic('scan', 20)}Распознаю штрихкод…</div></section>`;
  try {
    const code = await Scan.decodeFile(file);
    if (code) handleCode(code);
    else out.innerHTML = `<section class="card"><div class="banner warn">${ic('info', 18)}<div><b>Штрихкод не распознан.</b><br>Снимите ближе, при хорошем освещении, чтобы полосы были чёткими и занимали большую часть кадра. Или введите цифры под штрихкодом вручную.</div></div></section>`;
  } catch (e) { console.error(e); out.innerHTML = `<section class="card"><div class="banner warn">Не удалось обработать изображение: ${esc(e.message || e)}</div></section>`; }
};
ACT.scanManual = (f) => { const v = f.code.value.replace(/\D/g, ''); if (!/^\d{8}$|^\d{12,14}$/.test(v)) { markInvalid(f.code, 'Штрихкод — это 8, 12, 13 или 14 цифр'); return; } handleCode(v); };

async function handleCode(raw) {
  const code = String(raw).trim();
  const qr = code.match(/#(food|recipe)-([A-Za-z0-9-]+)/);
  if (qr) { openDeepLink(qr[1] + '-' + qr[2]); return; }
  const out = $('#scanResult'); if (!out) return;
  const digits = code.replace(/\D/g, '');
  if (!digits || digits.length < 8) { out.innerHTML = `<section class="card"><div class="banner warn">Распознан код «${esc(code.slice(0, 60))}», но это не штрихкод продукта.</div></section>`; return; }
  out.innerHTML = `<section class="card"><div class="loading">${ic('search', 20)}Ищу продукт ${esc(digits)}…</div></section>`;
  let found = null, src = '';
  for (const p of BarcodeProviders) { try { found = await p.lookup(digits); } catch (e) { found = null; } if (found) { src = p.name; break; } }
  const ctx = App.scanCtx || { date: todayISO(), meal: autoMeal() };
  const checksum = validEAN(digits) ? '' : '<p class="muted sm">⚠ Контрольная цифра не сходится — проверьте, верно ли считан код.</p>';
  if (found) {
    const g = found.portion && found.portion.g ? found.portion.g : 100;
    out.innerHTML = `<section class="card found fade">
      <div class="row between"><span class="tag ok">${ic('check', 14)}Найдено · ${esc(src)}</span><code class="mono sm">${esc(digits)}</code></div>
      <h2 class="mt8" translate="no">${esc(found.name)}</h2><p class="muted">${esc(found.brand || 'Производитель не указан')}</p>
      <div class="per100"><div><b>${fmt(found.per.kcal)}</b><span>ккал</span></div><div><b>${fmt(found.per.p, 1)}</b><span>белки</span></div><div><b>${fmt(found.per.f, 1)}</b><span>жиры</span></div><div><b>${fmt(found.per.c, 1)}</b><span>углеводы</span></div></div>
      <p class="muted sm">на 100 г${found.external ? ' · данные открытой базы, сверьте с упаковкой' : ''}</p>${checksum}
      <form class="form mt12" data-k="add"><div class="f2"><label>Съедено, г<input class="input" name="g" inputmode="decimal" value="${g}"></label>
        <label>Приём пищи<select class="input" name="meal">${MEALS.map((m) => `<option value="${m.id}" ${m.id === ctx.meal ? 'selected' : ''}>${m.name}</option>`).join('')}</select></label></div>
        <label>Дата<input class="input" type="date" name="date" value="${ctx.date}"></label>
        <div class="preview" data-k="prev"></div>
        <button class="btn primary block">${ic('plus', 18)}Добавить в дневник</button></form></section>`;
    const form = out.querySelector('[data-k=add]'); const prev = out.querySelector('[data-k=prev]');
    const upd = () => { const n = scaleN(found.per, num(form.g.value) || 0); prev.innerHTML = `<div class="pv-k"><b>${fmt(n.kcal)}</b><span>ккал</span></div><div><b>${fmt(n.p, 1)}</b><span>белки</span></div><div><b>${fmt(n.f, 1)}</b><span>жиры</span></div><div><b>${fmt(n.c, 1)}</b><span>углеводы</span></div>`; };
    form.addEventListener('input', upd); upd();
    form.onsubmit = (e) => {
      e.preventDefault(); const gv = num(form.g.value); if (!(gv > 0 && gv <= 5000)) { markInvalid(form.g, 'Укажите вес от 1 до 5000 г'); return; }
      let food = found;
      if (found.external) { // сохраняем в свою базу, чтобы находить без интернета
        const id = uid(); D.foods[id] = { kind: 'food', id, name: found.name, brand: found.brand, cat: 'custom', barcode: digits, per: found.per, portion: found.portion, source: found.external, updated: Date.now() };
        persist('food-' + id); invalidateFoods(); food = customAsFood(D.foods[id]);
      }
      addToDiary(form.date.value || todayISO(), form.meal.value, food, r1(gv));
      toast(`Добавлено: ${food.name}, ${fmt(gv)} г`); App.scanCtx = null; App.diaryDate = form.date.value || todayISO(); go('diary');
    };
  } else {
    out.innerHTML = `<section class="card fade"><div class="row between"><span class="tag warn">Не найдено</span><code class="mono sm">${esc(digits)}</code></div>
      <h3 class="mt8">Этого продукта ещё нет в базе</h3><p class="muted">Добавьте его один раз — дальше штрихкод будет находиться мгновенно.</p>${checksum}${navigator.onLine === false ? '<div class="banner warn">Нет интернета — онлайн-база штрихкодов сейчас недоступна. Создайте продукт вручную или отсканируйте позже.</div>' : ''}
      <div class="row gap8 wrap mt12"><button class="btn primary" data-act="scanCreate" data-code="${digits}">${ic('edit', 16)}Создать вручную</button>
      ${AI.photo ? `<label class="btn">${ic('camera', 16)}Сфотографировать этикетку (AI)<input type="file" accept="image/*" capture="environment" data-ch="labelPhoto" data-code="${digits}" hidden></label>` : ''}</div></section>`;
  }
}
ACT.scanCreate = (el) => openFoodForm({ barcode: el.dataset.code, afterSave: (f) => handleCode(f.barcode) });
ACT.labelPhoto = async (el) => {
  const file = el.files && el.files[0]; const code = el.dataset.code; el.value = ''; if (!file) return;
  const out = $('#scanResult'); const old = out.innerHTML;
  out.insertAdjacentHTML('beforeend', `<section class="card" id="lblLoad"><div class="loading">${ic('spark', 20)}Читаю этикетку…</div></section>`);
  try {
    const blob = await shrinkImage(file, 1400);
    const data = await AI.task('label', { blob });
    $('#lblLoad') && $('#lblLoad').remove();
    if (!data || data.error || data.found === false) { toast('Не удалось найти таблицу КБЖУ на фото. Попробуйте снять ближе.', 'warn'); return; }
    openFoodForm({ barcode: code, food: { name: data.name || '', brand: data.brand || '', cat: 'custom', per: { kcal: data.kcal, p: data.p, f: data.f, c: data.c, fib: data.fib, sug: data.sug, salt: data.salt }, portion: { g: data.portion_g || 100, label: 'упаковка' } }, isCopy: true,
      note: `Значения считаны AI с фото${data.confidence === 'low' ? ' (низкая уверенность)' : ''}. Сверьте их с упаковкой и исправьте при необходимости.`, afterSave: (f) => handleCode(f.barcode) });
  } catch (e) { $('#lblLoad') && $('#lblLoad').remove(); out.innerHTML = old; toast(AI.errText(e), 'err'); }
};

/* Глубокие ссылки из QR (#food-..., #recipe-...) */
function openDeepLink(h) {
  if (h.startsWith('food-')) {
    let id = h.slice(5); if (id.startsWith('c-')) id = 'c_' + id.slice(2);
    if (findFood(id)) openFoodDetail(id); else toast('Этот продукт не найден в вашей базе', 'warn');
  } else if (h.startsWith('recipe-')) {
    const r = D.recipes[h.slice(7)]; if (r) openRecipeView(r.id); else toast('Это блюдо не найдено в вашей базе', 'warn');
  }
}

/* ============================================================
   КАЛЬКУЛЯТОР КАЛОРИЙ И КБЖУ
   ============================================================ */
const ACT_LEVELS = [
  { v: 1.2, n: 'Минимальная', d: 'сидячая работа/учёба, без тренировок' },
  { v: 1.375, n: 'Низкая', d: 'тренировки 1–3 раза в неделю' },
  { v: 1.55, n: 'Средняя', d: 'тренировки 3–5 раз в неделю' },
  { v: 1.725, n: 'Высокая', d: 'тренировки 6–7 раз в неделю' },
  { v: 1.9, n: 'Очень высокая', d: 'тяжёлый физический труд или 2 тренировки в день' },
];
/* Цели. adj — изменение калорий от поддержки для темпа «мягкий / умеренный / активный»,
   pk — белок г/кг, fk — минимум жиров г/кг, fp — доля жиров от калорий. */
const GOAL_CFG = {
  lose:     { n: 'Снижение веса',           s: 'Похудеть без спорта или с лёгкой активностью',           adj: [-0.10, -0.15, -0.20], pk: 1.6, fk: 0.8, fp: 0.28 },
  cut:      { n: 'Сушка',                   s: 'Убрать жир и сохранить мышцы: высокий белок + силовые',   adj: [-0.15, -0.20, -0.25], pk: 2.2, fk: 0.7, fp: 0.25 },
  recomp:   { n: 'Рекомпозиция',            s: 'Меньше жира и больше мышц при том же весе',               adj: [-0.05, -0.07, -0.10], pk: 2.0, fk: 0.8, fp: 0.27 },
  maintain: { n: 'Поддержание',             s: 'Держать текущий вес',                                     adj: [0, 0, 0],             pk: 1.6, fk: 0.8, fp: 0.28 },
  lean:     { n: 'Чистый набор',            s: 'Мышцы с минимумом жира: небольшой профицит',              adj: [0.05, 0.08, 0.10],    pk: 2.0, fk: 0.8, fp: 0.25 },
  gain:     { n: 'Массонабор',              s: 'Быстрый набор массы и силы: профицит и много углеводов',  adj: [0.10, 0.15, 0.20],    pk: 1.8, fk: 0.9, fp: 0.25 },
};
const GOALS = Object.fromEntries(Object.entries(GOAL_CFG).map(([k, g]) => [k, g.n]));
const goalOptions = (cur) => Object.entries(GOAL_CFG).map(([k, g]) => `<option value="${k}" ${(cur || 'maintain') === k ? 'selected' : ''}>${g.n}</option>`).join('');
const goalHint = (k) => (GOAL_CFG[k] ? GOAL_CFG[k].s : '');
ACT.goalHint = (el) => { const h = el.closest('label') && el.closest('label').querySelector('.goal-hint'); if (h) h.textContent = goalHint(el.value); };
const paceLevel = (pace) => (+pace <= 0.1 ? 0 : +pace >= 0.2 ? 2 : 1);

function calcTargets({ sex, age, height, weight, activity, goal, pace }) {
  const bmr = 10 * weight + 6.25 * height - 5 * age + (sex === 'm' ? 5 : -161);
  const tdee = bmr * activity; const notes = []; const teen = age < 18; const child = age < 14;
  let g = GOAL_CFG[goal] ? goal : 'maintain';
  if (child && g !== 'maintain') { g = 'maintain'; notes.push({ t: 'warn', m: 'До 14 лет цели по снижению или набору веса не рассчитываются. Организм растёт — питание лучше обсудить с педиатром.' }); }
  const cfg = GOAL_CFG[g]; let adj = cfg.adj[paceLevel(pace)];
  if (teen) adj = clamp(adj, -0.1, 0.1);
  let kcal = tdee * (1 + adj);
  const floor = teen ? tdee * 0.9 : Math.max(bmr, sex === 'm' ? 1500 : 1200);
  if (kcal < floor) { kcal = floor; notes.push({ t: 'warn', m: 'Калорийность ограничена безопасным минимумом. Более жёсткий дефицит мы не предлагаем.' }); }
  if (teen) notes.push({ t: 'info', m: 'Возраст до 18 лет: во время роста важно получать достаточно энергии и белка. Только мягкая коррекция без жёстких диет.' });
  if (g === 'cut') notes.push({ t: 'info', m: 'Сушка работает только вместе с силовыми тренировками 3+ раза в неделю. Белок высокий, чтобы мышцы не уходили вместе с жиром. Темп — 0,5–1% веса в неделю.' });
  if (g === 'recomp') notes.push({ t: 'info', m: 'Рекомпозиция: вес почти не меняется, поэтому следите за обхватами и силовыми, а не только за весами. Лучше всего работает у новичков и после перерыва.' });
  if (g === 'lean') notes.push({ t: 'info', m: 'Чистый набор: цель +0,25–0,5% веса в месяц. Если вес растёт быстрее — уменьшите калории на 100–150.' });
  if (g === 'gain') notes.push({ t: 'info', m: 'Массонабор даёт быстрый рост силы, но и жира будет больше. Потом обычно идёт сушка.' });
  const pk = teen ? (g === 'maintain' ? 1.2 : 1.5) : cfg.pk;
  // При лишнем весе белок считаем от «нежировой» оценки, чтобы не получить 250+ г
  const bmi = weight / Math.pow(height / 100, 2);
  const wForP = bmi > 30 ? 25 * Math.pow(height / 100, 2) : weight;
  const p = pk * wForP;
  const f = Math.max(cfg.fk * weight, kcal * cfg.fp / 9);
  const c = Math.max(0, (kcal - p * 4 - f * 9) / 4);
  const fib = 14 * kcal / 1000; const water = Math.round(weight * 33 / 50) * 50;
  const weekly = (kcal - tdee) * 7 / 7700;
  return { bmr: r0(bmr), tdee: r0(tdee), kcal: Math.round(kcal / 10) * 10, p: r0(p), f: r0(f), c: r0(c), fib: r0(fib), water, weekly, goal: g, notes, pk };
}

PAGES.calc = {
  title: 'Калькулятор КБЖУ', icon: 'calc',
  render() {
    const P = D.profile || {}; const T = targets();
    return `
    <div class="pagehead"><div><h1>Калькулятор калорий и КБЖУ</h1><p class="muted">Формула Миффлина — Сан Жеора. Это оценка: отслеживайте вес 2–3 недели и корректируйте.</p></div></div>
    <div class="grid g2">
      <section class="card">
        <form class="form" id="calcForm" data-in="calcLive" data-sub="calcApply">
          <div class="seg" data-k="sex"><label><input type="radio" name="sex" value="m" ${P.sex !== 'f' ? 'checked' : ''}><span>Мужской</span></label><label><input type="radio" name="sex" value="f" ${P.sex === 'f' ? 'checked' : ''}><span>Женский</span></label></div>
          <div class="f3"><label>Возраст<input class="input" name="age" inputmode="numeric" value="${P.age || ''}"></label>
            <label>Рост, см<input class="input" name="height" inputmode="decimal" value="${curHeight() || ''}"></label>
            <label>Вес, кг<input class="input" name="weight" inputmode="decimal" value="${r1(curWeight()) || ''}"></label></div>
          <label>Физическая активность<select class="input" name="activity">${ACT_LEVELS.map((a) => `<option value="${a.v}" ${(+P.activity || 1.375) === a.v ? 'selected' : ''}>${a.n} — ${a.d}</option>`).join('')}</select></label>
          <label>Цель<select class="input" name="goal" data-ch="goalHint">${goalOptions(P.goal)}</select><small class="goal-hint muted">${goalHint(P.goal || 'maintain')}</small></label>
          <label data-k="pace">Темп<select class="input" name="pace">
            <option value="0.1" ${P.pace == 0.1 ? 'selected' : ''}>Мягкий</option><option value="0.15" ${!P.pace || P.pace == 0.15 ? 'selected' : ''}>Умеренный</option><option value="0.2" ${P.pace == 0.2 ? 'selected' : ''}>Активный</option></select></label>
          <div id="calcOut"></div>
        </form>
      </section>
      <section class="card">
        <div class="card-h"><h3>${ic('edit', 18)}Мои цели (вручную)</h3><span class="muted sm">${P.targetsManual ? 'заданы вручную' : 'из калькулятора'}</span></div>
        <form class="form" data-sub="targetsSave" id="tgForm" data-in="tgCheck">
          <div class="f2"><label>Калории, ккал<input class="input" name="kcal" inputmode="numeric" value="${T.kcal}"></label><label>Белки, г<input class="input" name="p" inputmode="numeric" value="${T.p}"></label>
          <label>Жиры, г<input class="input" name="f" inputmode="numeric" value="${T.f}"></label><label>Углеводы, г<input class="input" name="c" inputmode="numeric" value="${T.c}"></label>
          <label>Клетчатка, г<input class="input" name="fib" inputmode="numeric" value="${T.fib}"></label><label>Вода, мл<input class="input" name="water" inputmode="numeric" value="${T.water}"></label>
          <label>Шаги в день<input class="input" name="steps" inputmode="numeric" value="${T.steps}"></label><label>Желаемый вес, кг<input class="input" name="gw" inputmode="decimal" value="${P.goalWeight || ''}" placeholder="необязательно"></label></div>
          <p class="muted sm" id="tgHint"></p>
          <button class="btn primary block">Сохранить цели</button>
        </form>
        <p class="muted sm mt12">Цифры — ориентир, а не медицинская рекомендация. При заболеваниях, беременности, в подростковом возрасте или при спортивных целях высокого уровня обсудите питание со специалистом.</p>
      </section>
    </div>`;
  },
  mount() { ACT.calcLive(); ACT.tgCheck(); },
};
function readCalcForm(f, strict) {
  const o = { sex: f.querySelector('[name=sex]:checked').value, activity: +f.activity.value, goal: f.goal.value, pace: +f.pace.value };
  const lim = { age: [10, 100], height: [100, 250], weight: [25, 350] };
  for (const k of ['age', 'height', 'weight']) {
    const v = num(f[k].value); const ok = Number.isFinite(v) && v >= lim[k][0] && v <= lim[k][1];
    f[k].classList.toggle('invalid', !ok && f[k].value !== '');
    if (!ok) { if (strict) { markInvalid(f[k], `Проверьте поле: допустимо ${lim[k][0]}–${lim[k][1]}`); throw new Error('validation'); } return null; }
    o[k] = v;
  }
  return o;
}
ACT.calcLive = () => {
  const f = $('#calcForm'); if (!f) return; const out = $('#calcOut');
  const o = readCalcForm(f, false);
  const teen = o && o.age < 18;
  f.querySelector('[data-k=pace]').style.display = o && !teen && o.goal !== 'maintain' ? '' : 'none';
  if (!o) { out.innerHTML = '<p class="muted mt12">Заполните возраст, рост и вес — расчёт появится сразу.</p>'; return; }
  const r = calcTargets(o); App.lastCalc = { r, o };
  out.innerHTML = `<div class="calc-res fade">
    <div class="kpis k3"><div><span class="muted">Базовый обмен (BMR)</span><b>${fmt(r.bmr)}</b></div><div><span class="muted">Поддержка (TDEE)</span><b>${fmt(r.tdee)}</b></div><div class="acc"><span>Ваша цель</span><b>${fmt(r.kcal)}</b></div></div>
    <div class="macro-split"><div style="flex:${r.p * 4}" class="bp"><b>${r.p} г</b><span>белки</span></div><div style="flex:${r.f * 9}" class="bf"><b>${r.f} г</b><span>жиры</span></div><div style="flex:${Math.max(r.c * 4, 1)}" class="bc"><b>${r.c} г</b><span>углеводы</span></div></div>
    <p class="muted sm">Клетчатка ≈ ${r.fib} г · вода ≈ ${fmt(r.water)} мл · цель «${GOALS[r.goal]}» · белок ${fmt(r.pk, 1)} г/кг${r.goal !== 'maintain' ? `, ожидаемо ${r.weekly > 0 ? '+' : ''}${fmt(r.weekly, 2)} кг/нед` : ''}</p>
    ${r.notes.map((n) => `<div class="banner ${n.t}">${ic('info', 18)}<div>${n.m}</div></div>`).join('')}
    <button class="btn primary block mt12">Применить как мои цели</button></div>`;
};
ACT.calcApply = validated((f) => {
  const o = readCalcForm(f, true); const r = calcTargets(o);
  D.profile = Object.assign(D.profile || {}, { sex: o.sex, age: o.age, activity: o.activity, goal: r.goal, pace: o.pace, targetsManual: false,
    targets: { kcal: r.kcal, p: r.p, f: r.f, c: r.c, fib: r.fib, water: r.water } });
  if (Math.abs(curHeight() - o.height) > 0.4) { D.profile.heights = [...(D.profile.heights || []), { date: todayISO(), cm: o.height }]; }
  if (Math.abs(curWeight() - o.weight) > 0.05) { upsertWeight(todayISO(), o.weight, ''); }
  persist('profile'); toast('Цели обновлены'); render();
});
ACT.tgCheck = () => {
  const f = $('#tgForm'); if (!f) return;
  const k = num(f.kcal.value), p = num(f.p.value), fa = num(f.f.value), c = num(f.c.value);
  const est = p * 4 + fa * 9 + c * 4;
  $('#tgHint').textContent = [k, p, fa, c].every(Number.isFinite) ? `Б×4 + Ж×9 + У×4 = ${fmt(est)} ккал${Math.abs(est - k) > k * 0.07 ? ` — не совпадает с целью ${fmt(k)} ккал` : ' — сходится с целью'}` : '';
};
ACT.targetsSave = validated((f) => {
  const t = { kcal: readNum(f, 'kcal', { min: 800, max: 6000, label: 'Калории' }), p: readNum(f, 'p', { min: 20, max: 400, label: 'Белки' }), f: readNum(f, 'f', { min: 15, max: 300, label: 'Жиры' }),
    c: readNum(f, 'c', { min: 0, max: 900, label: 'Углеводы' }), fib: readNum(f, 'fib', { min: 5, max: 80, label: 'Клетчатка' }), water: readNum(f, 'water', { min: 500, max: 6000, label: 'Вода' }) };
  f.steps.value = f.steps.value.replace(/[\s\u00a0]/g, '');
  const steps = readNum(f, 'steps', { min: 500, max: 60000, label: 'Шаги', int: true });
  const gw = readNum(f, 'gw', { min: 25, max: 350, required: false, label: 'Желаемый вес' });
  const P = D.profile || {};
  if (P.age && P.age < 18 && t.kcal < calcTargets({ sex: P.sex || 'm', age: P.age, height: curHeight(), weight: curWeight(), activity: +P.activity || 1.375, goal: 'maintain' }).tdee * 0.85) {
    markInvalid(f.kcal, 'До 18 лет мы не сохраняем цель ниже 85% от поддерживающей калорийности'); return;
  }
  D.profile = Object.assign(P, { targets: t, targetsManual: true, stepsGoal: steps, goalWeight: gw });
  persist('profile'); toast('Цели сохранены'); render();
});

/* ============================================================
   ВЕС И ПРОГРЕСС
   ============================================================ */
function upsertWeight(date, kg, note) {
  const e = D.weights.entries.find((x) => x.date === date);
  if (e) { e.kg = kg; if (note != null) e.note = note; } else D.weights.entries.push({ date, kg, note: note || '' });
  D.weights.entries.sort((a, b) => (a.date < b.date ? -1 : 1)); persist('weights');
}
PAGES.weight = {
  title: 'Вес и прогресс', icon: 'scale',
  render() {
    const all = [...D.weights.entries].sort((a, b) => (a.date < b.date ? -1 : 1));
    const R = App.weightRange; const from = R ? addDays(todayISO(), -R) : (all[0] ? all[0].date : todayISO());
    const list = all.filter((e) => e.date >= from);
    const first = list[0], last = list[list.length - 1];
    const ch = list.length > 1 ? last.kg - first.kg : null;
    const span = list.length > 1 ? Math.max(1, diffDays(first.date, last.date)) : 0;
    const P = D.profile || {}; const gw = P.goalWeight;
    const heights = [...((P.heights) || [])].sort((a, b) => (a.date < b.date ? 1 : -1));
    return `
    <div class="pagehead"><div><h1>Вес и прогресс</h1><p class="muted">Вес колеблется день ко дню из-за воды и соли — смотрите на тренд за недели.</p></div>
      <button class="btn primary" data-act="weightAdd">${ic('plus', 18)}Записать вес</button></div>
    <section class="card">
      <div class="seg">${[[7, 'Неделя'], [30, 'Месяц'], [90, '3 мес'], [180, '6 мес'], [365, 'Год'], [0, 'Всё']].map(([v, n]) => `<button class="${R === v ? 'on' : ''}" data-act="wRange" data-v="${v}">${n}</button>`).join('')}</div>
      <div class="kpis mt12">
        <div><span class="muted">Сейчас</span><b>${last ? fmt(last.kg, 1) + ' кг' : '—'}</b></div>
        <div><span class="muted">Изменение</span><b>${ch == null ? '—' : (ch > 0 ? '+' : '') + fmt(ch, 1) + ' кг'}</b></div>
        <div><span class="muted">В неделю</span><b>${span >= 7 ? (ch > 0 ? '+' : '') + fmt(ch / span * 7, 2) + ' кг' : '—'}</b></div>
        <div><span class="muted">Мин / макс</span><b>${list.length ? fmt(Math.min(...list.map((e) => e.kg)), 1) + ' / ' + fmt(Math.max(...list.map((e) => e.kg)), 1) : '—'}</b></div>
      </div>
      <div class="chart-box mt12" id="wChart"></div>
      ${gw && last ? `<p class="muted sm">Желаемый вес: ${fmt(gw, 1)} кг · разница ${fmt(Math.abs(last.kg - gw), 1)} кг. Цель — ориентир, а не оценка вас.</p>` : ''}
    </section>
    <div class="grid g2">
      <section class="card">
        <div class="card-h"><h3>${ic('list', 18)}История измерений</h3><span class="muted sm">${all.length} записей</span></div>
        ${all.length ? `<div class="list">${[...all].reverse().slice(0, 60).map((e, i, arr) => { const prev = arr[i + 1]; const d = prev ? e.kg - prev.kg : null; return `
          <div class="li" data-act="weightEdit" data-d="${e.date}" role="button"><div class="grow"><b>${fmt(e.kg, 1)} кг</b><small class="muted">${fmtDate(e.date, { full: true })}${e.note ? ' · ' + esc(e.note) : ''}</small></div>
          ${d != null ? `<span class="delta">${d > 0 ? '+' : ''}${fmt(d, 1)}</span>` : ''}${ic('right', 16, 'dim')}</div>`; }).join('')}</div>`
          : emptyState('scale', 'Пока нет записей', 'Взвешивайтесь утром натощак 1–2 раза в неделю.')}
      </section>
      <section class="card">
        <div class="card-h"><h3>${ic('up', 18)}Рост</h3><button class="btn sm" data-act="heightAdd">Изменить</button></div>
        <div class="bignum">${fmt(curHeight())}<small> см</small></div>
        ${heights.length ? `<div class="list mt8">${heights.slice(0, 6).map((h) => `<div class="li"><div class="grow">${fmt(h.cm)} см</div><small class="muted">${fmtDate(h.date, { full: true })}</small></div>`).join('')}</div>` : '<p class="muted sm">История роста появится после первого изменения.</p>'}
        <div class="banner info mt12">${ic('info', 18)}<div>Вес и рост — лишь часть картины. Самочувствие, сила, сон и энергия не менее важны, поэтому выводов о здоровье по одному весу мы не делаем.</div></div>
      </section>
    </div>`;
  },
  mount() {
    const all = [...D.weights.entries].sort((a, b) => (a.date < b.date ? -1 : 1));
    const R = App.weightRange; const from = R ? addDays(todayISO(), -R) : (all[0] ? all[0].date : todayISO());
    const list = all.filter((e) => e.date >= from); const gw = D.profile && D.profile.goalWeight;
    let labels, values, tips;
    if (R && R <= 90) { const days = rangeDays(from, todayISO()); const map = Object.fromEntries(list.map((e) => [e.date, e.kg])); labels = days.map(fmtShort); values = days.map((d) => map[d] ?? null); tips = days.map((d) => fmtDate(d, { full: true })); }
    else { labels = list.map((e) => fmtShort(e.date)); values = list.map((e) => e.kg); tips = list.map((e) => fmtDate(e.date, { full: true })); }
    // Скользящее среднее за 7 записей — тренд без шума
    const vals = values.map((v, i) => { if (v == null) return null; const w = values.slice(0, i + 1).filter((x) => x != null).slice(-7); return w.length >= 3 ? w.reduce((a, b) => a + b, 0) / w.length : null; });
    Charts.mount($('#wChart'), (el) => Charts.line(el, { labels, tipLabels: tips, series: [{ name: 'Вес', values, color: 'var(--accent-ink)', area: !(R && R <= 90) }, ...(vals.filter((x) => x != null).length > 1 ? [{ name: 'Тренд', values: vals, color: 'var(--muted)' }] : [])], target: gw || null, unit: 'кг', decimals: 1, height: 240, connect: true, empty: 'Добавьте хотя бы одно измерение' }));
  },
};
ACT.wRange = (el) => { App.weightRange = +el.dataset.v; render(); };
ACT.weightAdd = () => openWeightForm({ date: todayISO(), kg: r1(curWeight()), note: '' }, false);
ACT.weightEdit = (el) => { const e = D.weights.entries.find((x) => x.date === el.dataset.d); if (e) openWeightForm(e, true); };
function openWeightForm(e, editing) {
  const s = Sheet.open({ title: editing ? 'Измерение веса' : 'Записать вес', body: `<form class="form" data-k="f">
    <div class="f2"><label>Вес, кг<input class="input big" name="kg" inputmode="decimal" value="${e.kg}"></label><label>Дата<input class="input" type="date" name="date" value="${e.date}" max="${todayISO()}"></label></div>
    <label>Заметка<input class="input" name="note" value="${esc(e.note || '')}" maxlength="140" placeholder="утро, после сна…"></label>
    <button class="btn primary block">Сохранить</button>${editing ? '<button type="button" class="btn ghost danger-t block mt8" data-k="del">Удалить запись</button>' : ''}</form>` });
  const f = s.querySelector('[data-k=f]');
  f.onsubmit = validated((ev) => {
    ev.preventDefault(); const kg = readNum(f, 'kg', { min: 25, max: 350, label: 'Вес' }); const date = f.date.value;
    if (!date || date > todayISO()) { markInvalid(f.date, 'Выберите дату не позже сегодняшней'); return; }
    if (editing && date !== e.date) D.weights.entries = D.weights.entries.filter((x) => x.date !== e.date);
    upsertWeight(date, r1(kg), f.note.value.trim()); Sheet.close(); render(); toast('Вес сохранён');
  });
  const del = s.querySelector('[data-k=del]'); if (del) del.onclick = async () => { Sheet.close(); if (!(await confirmDlg('Удалить это измерение?'))) return; D.weights.entries = D.weights.entries.filter((x) => x.date !== e.date); persist('weights'); render(); };
}
ACT.heightAdd = () => {
  const s = Sheet.open({ title: 'Рост', body: `<form class="form" data-k="f"><label>Рост, см<input class="input big" name="cm" inputmode="decimal" value="${curHeight()}"></label><button class="btn primary block">Сохранить</button></form>` });
  const f = s.querySelector('[data-k=f]');
  f.onsubmit = validated((ev) => { ev.preventDefault(); const cm = readNum(f, 'cm', { min: 100, max: 250, label: 'Рост' }); D.profile = D.profile || {}; D.profile.heights = (D.profile.heights || []).filter((h) => h.date !== todayISO()); D.profile.heights.push({ date: todayISO(), cm: r1(cm) }); persist('profile'); Sheet.close(); render(); toast('Рост обновлён'); });
};

/* ============================================================
   ТРЕНИРОВКИ
   ============================================================ */
function allExercises() { return [...EXERCISES, ...D.exlib.list]; }
function exById(id) { return allExercises().find((e) => e.id === id) || { id, name: 'Упражнение', group: 'abs', eq: 'bw', steps: [] }; }

/* Схема тела: подсветка целевой группы мышц (спереди и сзади) */
function bodyMap(group, h = 150) {
  const on = (g) => (Array.isArray(g) ? g.includes(group) : g === group) ? 'var(--accent)' : 'var(--track)';
  const fig = (x0, parts) => `<g transform="translate(${x0},0)">
    <circle cx="50" cy="16" r="11" fill="var(--track)"/><rect x="45" y="27" width="10" height="7" rx="3" fill="var(--track)"/>${parts}</g>`;
  const front = fig(0, `
    <ellipse cx="29" cy="44" rx="9" ry="7.5" fill="${on('shoulders')}"/><ellipse cx="71" cy="44" rx="9" ry="7.5" fill="${on('shoulders')}"/>
    <rect x="37" y="38" width="12.5" height="17" rx="6" fill="${on('chest')}"/><rect x="50.5" y="38" width="12.5" height="17" rx="6" fill="${on('chest')}"/>
    <rect x="40" y="57" width="20" height="32" rx="6" fill="${on('abs')}"/>
    <ellipse cx="23" cy="64" rx="5.5" ry="12" fill="${on('biceps')}"/><ellipse cx="77" cy="64" rx="5.5" ry="12" fill="${on('biceps')}"/>
    <ellipse cx="19" cy="91" rx="4.5" ry="12" fill="var(--track)"/><ellipse cx="81" cy="91" rx="4.5" ry="12" fill="var(--track)"/>
    <rect x="38" y="91" width="24" height="12" rx="5" fill="var(--track)"/>
    <ellipse cx="43" cy="124" rx="8" ry="20" fill="${on('legs')}"/><ellipse cx="57" cy="124" rx="8" ry="20" fill="${on('legs')}"/>
    <ellipse cx="43" cy="166" rx="5.5" ry="17" fill="var(--track)"/><ellipse cx="57" cy="166" rx="5.5" ry="17" fill="var(--track)"/>`);
  const back = fig(110, `
    <ellipse cx="29" cy="44" rx="9" ry="7.5" fill="${on('shoulders')}"/><ellipse cx="71" cy="44" rx="9" ry="7.5" fill="${on('shoulders')}"/>
    <ellipse cx="50" cy="42" rx="14" ry="7" fill="${on('back')}"/>
    <path d="M37 50 Q50 54 63 50 L60 78 Q50 84 40 78 Z" fill="${on('back')}"/>
    <rect x="44" y="80" width="12" height="11" rx="4" fill="${on('back')}"/>
    <ellipse cx="23" cy="64" rx="5.5" ry="12" fill="${on('triceps')}"/><ellipse cx="77" cy="64" rx="5.5" ry="12" fill="${on('triceps')}"/>
    <ellipse cx="19" cy="91" rx="4.5" ry="12" fill="var(--track)"/><ellipse cx="81" cy="91" rx="4.5" ry="12" fill="var(--track)"/>
    <ellipse cx="43.5" cy="100" rx="8" ry="8" fill="${on('legs')}"/><ellipse cx="56.5" cy="100" rx="8" ry="8" fill="${on('legs')}"/>
    <ellipse cx="43" cy="128" rx="7.5" ry="18" fill="${on('legs')}"/><ellipse cx="57" cy="128" rx="7.5" ry="18" fill="${on('legs')}"/>
    <ellipse cx="43" cy="164" rx="6" ry="16" fill="${on('legs')}"/><ellipse cx="57" cy="164" rx="6" ry="16" fill="${on('legs')}"/>`);
  return `<svg viewBox="0 0 210 190" height="${h}" class="bodymap" role="img" aria-label="Работающие мышцы: ${MUSCLES[group] || ''}">${front}${back}
    <text x="50" y="189" text-anchor="middle" class="ax">спереди</text><text x="160" y="189" text-anchor="middle" class="ax">сзади</text></svg>`;
}

PAGES.workouts = {
  title: 'Тренировки', icon: 'dumbbell',
  render() {
    const tab = App.woTab;
    const tabs = [['programs', 'Программы'], ['history', 'История'], ['calendar', 'Календарь'], ['library', 'Упражнения']];
    return `
    <div class="pagehead"><div><h1>Тренировки</h1><p class="muted">Программы, выполнение подходов, история и библиотека техники.</p></div>
      ${D.active ? `<button class="btn primary" data-act="woOpen">${ic('timer', 18)}Продолжить: ${esc(D.active.name)}</button>` : `<button class="btn primary" data-act="woStartPick">${ic('play', 18)}Начать тренировку</button>`}</div>
    <div class="tabs big">${tabs.map(([k, n]) => `<button class="tab ${k === tab ? 'on' : ''}" data-act="woTab" data-t="${k}">${n}</button>`).join('')}</div>
    <div class="fade">${this['tab_' + tab]()}</div>`;
  },
  tab_programs() {
    const L = D.programs.list;
    return `<div class="row gap8 wrap mb12"><button class="btn" data-act="progNew">${ic('plus', 16)}Создать программу</button><button class="btn ghost" data-act="progTemplates">${ic('copy', 16)}Из шаблона</button></div>
      ${L.length ? `<div class="grid g2">${L.map((p) => `<section class="card prog">
        <div class="card-h"><h3>${esc(p.name)}</h3><span class="muted sm">${p.items.length} упр.</span></div>
        <div class="chips">${[...new Set(p.items.map((i) => exById(i.ex).group))].map((g) => `<span class="chip static">${MUSCLES[g]}</span>`).join('')}</div>
        <ol class="ex-mini">${p.items.slice(0, 6).map((i) => `<li>${esc(exById(i.ex).name)} <span class="muted">${i.sets}×${i.reps}${exById(i.ex).unit === 'sec' ? ' сек' : ''}${i.w ? ' · ' + i.w + ' кг' : ''}</span></li>`).join('')}</ol>
        <div class="row gap8 mt12"><button class="btn primary sm grow" data-act="woStart" data-id="${p.id}">${ic('play', 16)}Начать</button><button class="icon-btn" data-act="progEdit" data-id="${p.id}" aria-label="Изменить">${ic('edit')}</button><button class="icon-btn danger-t" data-act="progDel" data-id="${p.id}" aria-label="Удалить">${ic('trash')}</button></div>
      </section>`).join('')}</div>` : emptyState('dumbbell', 'Программ пока нет', 'Создайте свою или возьмите шаблон: дом с гантелями без скамьи, резинки, без инвентаря.', `<button class="btn primary" data-act="progTemplates">Выбрать шаблон</button>`)}`;
  },
  tab_history() {
    const L = Object.values(D.workouts).sort((a, b) => (a.date + (a.end || '') < b.date + (b.end || '') ? 1 : -1));
    if (!L.length) return emptyState('clock', 'История пуста', 'Завершённые тренировки появятся здесь.');
    return `<div class="card flush"><div class="list">${L.map((w) => `<div class="li pad" data-act="woView" data-id="${w.id}" role="button">
      <div class="grow"><b>${esc(w.name)}</b><small class="muted">${fmtDate(w.date, { full: true })} · ${w.durationMin} мин · ${w.exercises.length} упр. · ${w.exercises.reduce((s, e) => s + e.sets.filter((x) => x.done).length, 0)} подх.</small></div>
      <span class="muted">${fmt(woVolume(w))} кг</span>${ic('right', 16, 'dim')}</div>`).join('')}</div></div>`;
  },
  tab_calendar() {
    const month = App.calMonth || todayISO().slice(0, 7); const [y, mo] = month.split('-').map(Number);
    const first = new Date(y, mo - 1, 1); const startWd = (first.getDay() + 6) % 7; const daysIn = new Date(y, mo, 0).getDate();
    let cells = ''; for (let i = 0; i < startWd; i++) cells += '<span></span>';
    let cnt = 0;
    for (let d = 1; d <= daysIn; d++) {
      const iso = `${month}-${String(d).padStart(2, '0')}`; const ws = workoutsOn(iso); const acts = getDay(iso).activities.length; cnt += ws.length;
      cells += `<button class="cal-d ${ws.length ? 'm-ok' : acts ? 'm-act' : ''} ${iso === todayISO() ? 'today' : ''}" ${ws.length ? `data-act="woView" data-id="${ws[0].id}"` : ''}><b>${d}</b>${ws.length ? `<small>${esc(ws[0].name.split(' ')[0])}</small>` : acts ? '<small>актив.</small>' : ''}</button>`;
    }
    return `<section class="card"><div class="cal-h"><button class="icon-btn" data-act="woCal" data-v="-1">${ic('left')}</button><b>${MONTHS_N[mo - 1]} ${y} · ${cnt} ${plural(cnt, 'тренировка', 'тренировки', 'тренировок')}</b><button class="icon-btn" data-act="woCal" data-v="1">${ic('right')}</button></div>
      <div class="cal-g">${['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((w) => `<span class="cal-w">${w}</span>`).join('')}${cells}</div>
      <p class="muted sm mt12"><i class="dot ok"></i> тренировка <i class="dot act"></i> другая активность</p></section>`;
  },
  tab_library() {
    const g = App.exGroup || 'all'; const eq = App.exEq || 'all'; const q = norm(App.exQ || '');
    const L = allExercises().filter((e) => (g === 'all' || e.group === g) && (eq === 'all' || e.eq === eq) && (!q || norm(e.name).includes(q)));
    return `<div class="search"><span>${ic('search', 18)}</span><input class="input" type="search" placeholder="Поиск упражнения" value="${esc(App.exQ || '')}" data-ch="exSearch"></div>
      <div class="chips scroll">${[['all', 'Все мышцы'], ...Object.entries(MUSCLES)].map(([k, n]) => `<button class="chip ${g === k ? 'on' : ''}" data-act="exGroup" data-v="${k}">${n}</button>`).join('')}</div>
      <div class="chips scroll">${[['all', 'Любой инвентарь'], ...Object.entries(EQUIP)].map(([k, n]) => `<button class="chip ${eq === k ? 'on' : ''}" data-act="exEq" data-v="${k}">${n}</button>`).join('')}</div>
      <div class="row mb12"><button class="btn sm" data-act="exNew">${ic('plus', 16)}Своё упражнение</button></div>
      <div class="exgrid">${L.map((e) => `<button class="excard" data-act="exView" data-id="${e.id}">${bodyMap(e.group, 92)}<b>${esc(e.name)}</b><small class="muted">${MUSCLES[e.group]} · ${EQUIP[e.eq]}</small></button>`).join('') || '<p class="muted">Ничего не найдено.</p>'}</div>`;
  },
};
ACT.woTab = (el) => { App.woTab = el.dataset.t; render(); };
ACT.woCal = (el) => { const m = App.calMonth || todayISO().slice(0, 7); const [y, mo] = m.split('-').map(Number); App.calMonth = isoOf(new Date(y, mo - 1 + +el.dataset.v, 1)).slice(0, 7); render(); };
ACT.exGroup = (el) => { App.exGroup = el.dataset.v; render(); };
ACT.exEq = (el) => { App.exEq = el.dataset.v; render(); };
ACT.exSearch = (el) => { App.exQ = el.value; render(); };
ACT.exView = (el) => {
  const e = exById(el.dataset.id);
  const s = Sheet.open({ title: e.name, wide: true, body: `<div class="exview"><div class="exmap">${bodyMap(e.group, 200)}</div>
    <div><p><span class="chip static">${MUSCLES[e.group]}</span> <span class="chip static">${EQUIP[e.eq]}</span></p>
    <h4>Техника выполнения</h4><ol class="steps-list">${(e.steps || []).map((s2) => `<li>${esc(s2)}</li>`).join('') || '<li>Описание не добавлено.</li>'}</ol>
    ${e.errors && e.errors.length ? `<h4>Частые ошибки</h4><ul class="errs">${e.errors.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    <p class="muted sm">Начинайте с лёгкого веса и контролируемой техники. При боли — остановитесь.</p></div></div>`,
    foot: `${e.custom ? `<button class="icon-btn danger-t" data-k="del" aria-label="Удалить">${ic('trash')}</button>` : ''}<button class="btn primary grow" data-k="add">Добавить в программу</button>` });
  s.querySelector('[data-k=add]').onclick = () => {
    if (!D.programs.list.length) { Sheet.close(); openProgramEditor({ name: 'Моя программа', items: [{ ex: e.id, sets: 3, reps: e.unit === 'sec' ? 30 : 10, w: 0, rest: 60 }] }); return; }
    Sheet.setBody(`<div class="menu">${D.programs.list.map((p) => `<button data-p="${p.id}">${ic('dumbbell')}${esc(p.name)}</button>`).join('')}<button data-p="new">${ic('plus')}Новая программа</button></div>`);
    s.querySelector('.sheet-foot').remove();
    s.querySelectorAll('[data-p]').forEach((b) => { b.onclick = () => {
      const item = { ex: e.id, sets: 3, reps: e.unit === 'sec' ? 30 : 10, w: 0, rest: 60 };
      Sheet.close();
      if (b.dataset.p === 'new') { openProgramEditor({ name: 'Моя программа', items: [item] }); return; }
      const p = D.programs.list.find((x) => x.id === b.dataset.p); p.items.push(item); persist('programs'); toast(`Добавлено в «${p.name}»`); render();
    }; });
  };
  const del = s.querySelector('[data-k=del]'); if (del) del.onclick = async () => { Sheet.close(); if (!(await confirmDlg('Удалить своё упражнение?'))) return; D.exlib.list = D.exlib.list.filter((x) => x.id !== e.id); persist('exlib'); render(); };
};
ACT.exNew = () => {
  const s = Sheet.open({ title: 'Своё упражнение', body: `<form class="form" data-k="f">
    <label>Название*<input class="input" name="name" maxlength="80"></label>
    <div class="f2"><label>Группа мышц<select class="input" name="group">${Object.entries(MUSCLES).map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></label>
    <label>Инвентарь<select class="input" name="eq">${Object.entries(EQUIP).map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></label></div>
    <label>Измерять<select class="input" name="unit"><option value="reps">Повторениями</option><option value="sec">Секундами</option></select></label>
    <label>Техника (каждый шаг с новой строки)<textarea class="input" name="steps" rows="4" maxlength="800"></textarea></label>
    <button class="btn primary block">Сохранить</button></form>` });
  const f = s.querySelector('[data-k=f]');
  f.onsubmit = validated((ev) => { ev.preventDefault(); const name = readStr(f, 'name', { label: 'Название', max: 80 });
    D.exlib.list.push({ id: 'x' + uid(), name, group: f.group.value, eq: f.eq.value, unit: f.unit.value, steps: f.steps.value.split('\n').map((x) => x.trim()).filter(Boolean), custom: true });
    persist('exlib'); Sheet.close(); App.woTab = 'library'; render(); toast('Упражнение добавлено'); });
};

/* Программы */
ACT.progNew = () => openProgramEditor({ name: '', items: [] });
ACT.progEdit = (el) => openProgramEditor(clone(D.programs.list.find((p) => p.id === el.dataset.id)));
ACT.progDel = async (el) => { const p = D.programs.list.find((x) => x.id === el.dataset.id); if (!(await confirmDlg(`Удалить программу «${p.name}»? История тренировок сохранится.`))) return; D.programs.list = D.programs.list.filter((x) => x.id !== p.id); persist('programs'); render(); };
ACT.progTemplates = () => {
  const s = Sheet.open({ title: 'Шаблоны программ', body: `<div class="menu">${PROGRAM_TEMPLATES.map((t, i) => `<button data-i="${i}">${ic('dumbbell')}<span><b>${esc(t.name)}</b><small class="muted">${t.items.map((x) => exById(x[0]).name).slice(0, 3).join(', ')}…</small></span></button>`).join('')}</div><p class="muted sm">Шаблон копируется к вам — дальше меняйте как угодно.</p>` });
  s.querySelectorAll('[data-i]').forEach((b) => { b.onclick = () => { const t = PROGRAM_TEMPLATES[+b.dataset.i];
    D.programs.list.push({ id: uid(), name: t.name, items: t.items.map(([ex, sets, reps, w, rest]) => ({ ex, sets, reps, w, rest })) }); persist('programs'); Sheet.close(); App.woTab = 'programs'; render(); toast('Программа добавлена'); }; });
};
function openProgramEditor(prog) {
  const P = clone(prog); P.items = P.items || [];
  const draw = (s) => {
    s.querySelector('[data-k=items]').innerHTML = P.items.length ? P.items.map((it, i) => { const e = exById(it.ex); return `
      <div class="pe-row" data-i="${i}"><div class="pe-h"><b>${i + 1}. ${esc(e.name)}</b><span class="muted sm">${MUSCLES[e.group]}</span>
        <span class="row gap4"><button type="button" class="icon-btn sm" data-mv="-1" aria-label="Выше">${ic('up', 16)}</button><button type="button" class="icon-btn sm" data-mv="1" aria-label="Ниже">${ic('dn', 16)}</button><button type="button" class="icon-btn sm danger-t" data-rm aria-label="Убрать">${ic('x', 16)}</button></span></div>
        <div class="f4 tight"><label>Подходы<input class="input" data-f="sets" inputmode="numeric" value="${it.sets}"></label><label>${e.unit === 'sec' ? 'Секунды' : 'Повторения'}<input class="input" data-f="reps" inputmode="numeric" value="${it.reps}"></label>
        <label>Вес, кг<input class="input" data-f="w" inputmode="decimal" value="${it.w || 0}"></label><label>Отдых, с<input class="input" data-f="rest" inputmode="numeric" value="${it.rest || 60}"></label></div></div>`; }).join('')
      : '<p class="muted">Добавьте упражнения из библиотеки.</p>';
  };
  const s = Sheet.open({ title: prog.id ? 'Редактировать программу' : 'Новая программа', wide: true,
    body: `<label class="form">Название<input class="input" data-k="name" value="${esc(P.name)}" maxlength="80" placeholder="Например: Грудь + трицепс"></label>
      <div data-k="items" class="mt12"></div><button type="button" class="btn block mt12" data-k="add">${ic('plus', 16)}Добавить упражнение</button>`,
    foot: `<button class="btn primary grow" data-k="save">Сохранить программу</button>` });
  draw(s);
  s.querySelector('[data-k=items]').addEventListener('input', (e) => { const inp = e.target.closest('[data-f]'); if (!inp) return; const i = +inp.closest('[data-i]').dataset.i; P.items[i][inp.dataset.f] = inp.value; });
  s.querySelector('[data-k=items]').addEventListener('click', (e) => {
    const row = e.target.closest('[data-i]'); if (!row) return; const i = +row.dataset.i;
    if (e.target.closest('[data-rm]')) { P.items.splice(i, 1); draw(s); }
    const mv = e.target.closest('[data-mv]'); if (mv) { const j = i + +mv.dataset.mv; if (j >= 0 && j < P.items.length) { [P.items[i], P.items[j]] = [P.items[j], P.items[i]]; draw(s); } }
  });
  s.querySelector('[data-k=add]').onclick = () => pickExercise((e) => { P.items.push({ ex: e.id, sets: 3, reps: e.unit === 'sec' ? 30 : 10, w: 0, rest: 60 }); draw(s); });
  s.querySelector('[data-k=save]').onclick = () => {
    P.name = s.querySelector('[data-k=name]').value.trim();
    if (!P.name) { markInvalid(s.querySelector('[data-k=name]'), 'Введите название программы'); return; }
    if (!P.items.length) { toast('Добавьте хотя бы одно упражнение', 'err'); return; }
    for (const [i, it] of P.items.entries()) {
      const sets = num(it.sets), reps = num(it.reps), w = num(it.w), rest = num(it.rest);
      if (!(sets >= 1 && sets <= 20 && reps >= 1 && reps <= 600 && w >= 0 && w <= 500 && rest >= 0 && rest <= 900)) { toast(`Упражнение ${i + 1}: проверьте подходы (1–20), повторения (1–600), вес (0–500), отдых (0–900)`, 'err'); return; }
      Object.assign(it, { sets: r0(sets), reps: r0(reps), w: r1(w), rest: r0(rest) });
    }
    if (P.id) { const k = D.programs.list.findIndex((x) => x.id === P.id); D.programs.list[k] = P; } else { P.id = uid(); D.programs.list.push(P); }
    persist('programs'); Sheet.close(); App.woTab = 'programs'; render(); toast('Программа сохранена');
  };
}
function pickExercise(cb) {
  let g = 'all';
  const s = Sheet.open({ title: 'Выберите упражнение', wide: true, body: `<div class="chips scroll" data-k="g">${[['all', 'Все'], ...Object.entries(MUSCLES)].map(([k, n]) => `<button class="chip ${k === 'all' ? 'on' : ''}" data-v="${k}">${n}</button>`).join('')}</div><div data-k="l" class="list"></div>` });
  const draw = () => { s.querySelector('[data-k=l]').innerHTML = allExercises().filter((e) => g === 'all' || e.group === g).map((e) => `<div class="li pad" data-id="${e.id}" role="button"><div class="grow"><b>${esc(e.name)}</b><small class="muted">${MUSCLES[e.group]} · ${EQUIP[e.eq]}</small></div>${ic('plus', 18)}</div>`).join(''); };
  s.querySelector('[data-k=g]').onclick = (e) => { const b = e.target.closest('[data-v]'); if (!b) return; g = b.dataset.v; s.querySelectorAll('[data-k=g] .chip').forEach((x) => x.classList.toggle('on', x === b)); draw(); };
  s.querySelector('[data-k=l]').onclick = (e) => { const r = e.target.closest('[data-id]'); if (!r) return; Sheet.close(); cb(exById(r.dataset.id)); };
  draw();
}

/* Выполнение тренировки */
ACT.woStartPick = () => {
  const s = Sheet.open({ title: 'Начать тренировку', body: `<div class="menu">${D.programs.list.map((p) => `<button data-id="${p.id}">${ic('dumbbell')}<span><b>${esc(p.name)}</b><small class="muted">${p.items.length} упр.</small></span></button>`).join('')}
    <button data-id="">${ic('plus')}<span><b>Пустая тренировка</b><small class="muted">добавлять упражнения по ходу</small></span></button></div>${!D.programs.list.length ? '<p class="muted sm">Совет: создайте программу во вкладке «Программы».</p>' : ''}` });
  s.querySelectorAll('[data-id]').forEach((b) => { b.onclick = () => { Sheet.close(); startWorkout(b.dataset.id); }; });
};
ACT.woStart = (el) => startWorkout(el.dataset.id);
function startWorkout(pid) {
  if (D.active) { toast('Сначала завершите текущую тренировку', 'warn'); go('workouts'); openActive(); return; }
  const p = D.programs.list.find((x) => x.id === pid);
  D.active = { kind: 'active', id: uid(), programId: pid || null, name: p ? p.name : 'Свободная тренировка', start: Date.now(), date: todayISO(),
    exercises: p ? p.items.map((it) => ({ ex: it.ex, rest: it.rest, sets: Array.from({ length: it.sets }, () => ({ reps: it.reps, w: it.w, done: false })) })) : [] };
  persist('active'); go('workouts'); openActive();
}
ACT.woOpen = () => openActive();
let restTimer = null;
function openActive() {
  if (!D.active) return;
  const A = D.active;
  const draw = (s) => {
    const body = s.querySelector('[data-k=ex]');
    body.innerHTML = A.exercises.length ? A.exercises.map((x, i) => { const e = exById(x.ex); const done = x.sets.filter((z) => z.done).length; return `
      <div class="wo-ex ${done === x.sets.length && x.sets.length ? 'complete' : ''}" data-i="${i}">
        <div class="pe-h"><b>${esc(e.name)}</b><span class="muted sm">${done}/${x.sets.length} · отдых ${x.rest || 60} с</span><button class="icon-btn sm" data-info aria-label="Техника">${ic('info', 16)}</button><button class="icon-btn sm danger-t" data-rmex aria-label="Убрать">${ic('x', 16)}</button></div>
        <div class="sets"><div class="set head"><span>#</span><span>Вес, кг</span><span>${e.unit === 'sec' ? 'Сек' : 'Повт.'}</span><span>✓</span></div>
        ${x.sets.map((z, j) => `<div class="set ${z.done ? 'done' : ''}" data-j="${j}"><span>${j + 1}</span><input class="input" data-f="w" inputmode="decimal" value="${z.w}"><input class="input" data-f="reps" inputmode="numeric" value="${z.reps}"><button class="chk ${z.done ? 'on' : ''}" data-done aria-label="Отметить подход">${ic('check', 16)}</button></div>`).join('')}</div>
        <div class="row gap8 mt8"><button class="btn sm ghost" data-addset>${ic('plus', 14)}Подход</button>${x.sets.length > 1 ? `<button class="btn sm ghost" data-rmset>${ic('minus', 14)}Подход</button>` : ''}</div></div>`; }).join('')
      : '<p class="muted">Добавьте упражнения.</p>';
  };
  const s = Sheet.open({ title: A.name, wide: true,
    body: `<div class="wo-top"><div><span class="muted sm">Время</span><b data-k="clock">0:00</b></div><div class="rest" data-k="rest" hidden><span class="muted sm">Отдых</span><b data-k="rt">0</b><button class="btn sm ghost" data-k="skip">Пропустить</button></div></div>
      <div data-k="ex"></div><button class="btn block mt12" data-k="addex">${ic('plus', 16)}Добавить упражнение</button>`,
    foot: `<button class="btn ghost danger-t" data-k="cancel">Отменить</button><button class="btn primary grow" data-k="finish">${ic('check', 16)}Завершить</button>`,
    onClose: () => { clearInterval(clockIv); render(); } });
  draw(s);
  const clock = s.querySelector('[data-k=clock]');
  const tick = () => { const sec = Math.floor((Date.now() - A.start) / 1000); clock.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };
  tick(); const clockIv = setInterval(tick, 1000);
  const restBox = s.querySelector('[data-k=rest]'); const rt = s.querySelector('[data-k=rt]');
  const startRest = (secs) => {
    clearInterval(restTimer); let left = secs; restBox.hidden = false; rt.textContent = left;
    restTimer = setInterval(() => { left--; rt.textContent = Math.max(0, left); if (left <= 0) { clearInterval(restTimer); restBox.hidden = true; if (navigator.vibrate) navigator.vibrate([120, 60, 120]); toast('Отдых окончен — следующий подход!'); } }, 1000);
  };
  s.querySelector('[data-k=skip]').onclick = () => { clearInterval(restTimer); restBox.hidden = true; };
  const ex = s.querySelector('[data-k=ex]');
  let saveT; const save = () => { clearTimeout(saveT); saveT = setTimeout(() => persist('active'), 400); };
  ex.addEventListener('input', (e) => { const inp = e.target.closest('[data-f]'); if (!inp) return; const i = +inp.closest('[data-i]').dataset.i, j = +inp.closest('[data-j]').dataset.j; const v = num(inp.value); inp.classList.toggle('invalid', !(v >= 0 && v <= (inp.dataset.f === 'w' ? 500 : 600))); A.exercises[i].sets[j][inp.dataset.f] = Number.isFinite(v) ? v : 0; save(); });
  ex.addEventListener('click', (e) => {
    const box = e.target.closest('[data-i]'); if (!box) return; const i = +box.dataset.i; const X = A.exercises[i];
    if (e.target.closest('[data-done]')) { const j = +e.target.closest('[data-j]').dataset.j; X.sets[j].done = !X.sets[j].done; if (X.sets[j].done) startRest(X.rest || 60); draw(s); save(); }
    else if (e.target.closest('[data-addset]')) { const l = X.sets[X.sets.length - 1] || { reps: 10, w: 0 }; X.sets.push({ reps: l.reps, w: l.w, done: false }); draw(s); save(); }
    else if (e.target.closest('[data-rmset]')) { X.sets.pop(); draw(s); save(); }
    else if (e.target.closest('[data-rmex]')) { A.exercises.splice(i, 1); draw(s); save(); }
    else if (e.target.closest('[data-info]')) { ACT.exView({ dataset: { id: X.ex } }); }
  });
  s.querySelector('[data-k=addex]').onclick = () => pickExercise((e) => { A.exercises.push({ ex: e.id, rest: 60, sets: Array.from({ length: 3 }, () => ({ reps: e.unit === 'sec' ? 30 : 10, w: 0, done: false })) }); draw(s); save(); });
  s.querySelector('[data-k=cancel]').onclick = async () => { if (!(await confirmDlg('Отменить тренировку? Отмеченные подходы не сохранятся.', 'Отменить тренировку'))) return; D.active = null; persist('active'); clearInterval(restTimer); Sheet.closeAll(); render(); };
  s.querySelector('[data-k=finish]').onclick = () => {
    const doneSets = A.exercises.reduce((n, x) => n + x.sets.filter((z) => z.done).length, 0);
    if (!doneSets) { toast('Отметьте хотя бы один выполненный подход', 'warn'); return; }
    const end = Date.now(); const w = { kind: 'workout', id: A.id, name: A.name, programId: A.programId, date: A.date, start: A.start, end, durationMin: Math.max(1, Math.round((end - A.start) / 60000)), weightKg: r1(curWeight()),
      exercises: A.exercises.map((x) => ({ ex: x.ex, name: exById(x.ex).name, group: exById(x.ex).group, sets: x.sets.map((z) => ({ reps: +z.reps || 0, w: +z.w || 0, done: !!z.done })) })).filter((x) => x.sets.some((z) => z.done)) };
    if (w.durationMin > 300) w.durationMin = Math.max(20, w.exercises.length * 10); // забытая открытой тренировка
    D.workouts[w.id] = w; persist('wo-' + w.id); D.active = null; persist('active'); clearInterval(restTimer);
    Sheet.closeAll(); App.woTab = 'history'; render(); toast(`Тренировка сохранена: ${doneSets} подходов, ${w.durationMin} мин`);
  };
}
ACT.woView = (el) => {
  const w = D.workouts[el.dataset.id]; if (!w) return;
  const s = Sheet.open({ title: w.name, wide: true, body: `<p class="muted">${fmtDate(w.date, { full: true })} · ${w.durationMin} мин · объём ${fmt(woVolume(w))} кг · ≈${fmt(workoutKcal(w))} ккал</p>
    ${w.exercises.map((x) => `<div class="wo-ex"><b>${esc(x.name)}</b><div class="chips">${x.sets.map((z) => `<span class="chip static ${z.done ? '' : 'dim'}">${z.w ? z.w + ' кг × ' : ''}${z.reps}</span>`).join('')}</div></div>`).join('')}`,
    foot: `<button class="btn ghost danger-t" data-k="del">${ic('trash', 16)}Удалить</button><button class="btn grow" data-k="rep">${ic('play', 16)}Повторить</button>` });
  s.querySelector('[data-k=del]').onclick = async () => { Sheet.close(); if (!(await confirmDlg('Удалить тренировку из истории?'))) return; delete D.workouts[w.id]; persist('wo-' + w.id); render(); };
  s.querySelector('[data-k=rep]').onclick = () => {
    Sheet.close(); if (D.active) { toast('Сначала завершите текущую тренировку', 'warn'); return; }
    D.active = { kind: 'active', id: uid(), programId: w.programId, name: w.name, start: Date.now(), date: todayISO(), exercises: w.exercises.map((x) => ({ ex: x.ex, rest: 60, sets: x.sets.map((z) => ({ reps: z.reps, w: z.w, done: false })) })) };
    persist('active'); openActive();
  };
};
