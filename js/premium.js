/* ============================================================
   FORMA Premium — подписка.
   • Статус хранит сервер (функция Supabase «premium», auth.users.app_metadata) — подделать его из приложения нельзя.
   • Получить: 7 дней бесплатно (раз на аккаунт), промокод, покупка в App Store / Google Play (RevenueCat),
     оплата картой на сайте (подключается после регистрации ИП — см. store/monetization.md).
   • Что даёт: AI 50 раз в день (без Premium — 3), «Меню на день от AI», статистика за 90 дней и любой период, цветовые темы.
   ============================================================ */
'use strict';

/* Настройки оплаты. Ключи RevenueCat — публичные (их можно хранить в приложении). */
const BILLING = {
  revenuecatIos: '',      // appl_… — из RevenueCat → Project → API keys (после аккаунта Apple Developer)
  revenuecatAndroid: '',  // goog_… — оттуда же (после Google Play Console)
  entitlement: 'premium',
  prices: { month: 1290, year: 7990 }, // ₸ — для сайта; в приложении цены показывает магазин
  // Цены сайта по регионам (по часовому поясу устройства). В App Store / Google Play цены по странам задаёт магазин.
  regions: {
    KZ: { cur: '₸', month: 1290, year: 7990, before: false },
    RU: { cur: '₽', month: 249, year: 1590, before: false },
    UZ: { cur: 'сум', month: 29000, year: 179000, before: false },
    INT: { cur: '$', month: 2.99, year: 19.99, before: true },
  },
};

const Premium = {
  st: { premium: false, until: null, src: null, trial_used: false },
  rcReady: false, offerings: null,
  pay: null, payCode: '', payReq: null, // оплата переводом (Kaspi): реквизиты, код для комментария, своя заявка
  active() { return !!this.st.premium && (!this.st.until || Date.parse(this.st.until) > Date.now()); },
  signed() { return Store.backend === 'supa' && !!Supa.client && !!Supa.user; },
  fromUser(u) {
    const m = (u && u.app_metadata) || {}; const until = m.premium_until || null;
    this.st = { premium: !!until && Date.parse(until) > Date.now(), until, src: m.premium_src || null, trial_used: !!m.trial_used };
  },
  async call(action, extra = {}) {
    if (!this.signed()) throw { code: 'auth' };
    if (navigator.onLine === false) throw { code: 'offline' };
    const { data, error } = await withTimeout(Supa.client.functions.invoke('premium', { body: { action, ...extra } }), 30000, 'Сервер не ответил');
    if (error) { let info = null; try { info = error.context && typeof error.context.json === 'function' ? await error.context.json() : null; } catch (e) { /* без тела */ } throw { code: (info && info.error) || 'server', info }; }
    if (data && 'premium' in data) { this.st = { premium: data.premium, until: data.until, src: data.src, trial_used: data.trial_used }; this.cache(); }
    try { await Supa.client.auth.refreshSession(); } catch (e) { /* статус уже обновлён */ }
    return data;
  },
  cache() { try { localStorage.setItem(LS + 'premium:' + Store.uid, JSON.stringify(this.st)); } catch (e) { /* нет хранилища */ } },
  async init() {
    if (!this.signed()) return;
    this.fromUser(Supa.user);
    try { const c = JSON.parse(localStorage.getItem(LS + 'premium:' + Store.uid) || 'null'); if (c && !this.st.until && c.until) this.st = c; } catch (e) { /* нет кэша */ }
    try { await this.call('status'); if (booted && ['premium', 'profile', 'stats'].includes(App.page) && !Sheet.stack.length) render(); } catch (e) { /* офлайн — берём из сессии */ }
    this.loadPay();
    if (Supa.isAdmin) this.adminPayPing();
    if (Native.on) this.rcInit();
  },
  // Реквизиты и своя заявка на оплату переводом
  async loadPay(force = false) {
    if (!this.signed() || this.payBusy) return;
    if (!force && this.payAt && Date.now() - this.payAt < 30000) return;
    this.payBusy = true; this.payAt = Date.now();
    try {
      const r = await this.call('pay-info');
      const before = this.payReq && this.payReq.status;
      this.pay = r.pay; this.payCode = r.code || ''; this.payReq = r.request || null;
      if (before === 'pending' && this.payReq && this.payReq.status === 'approved') toast('Оплата подтверждена — Premium включён 🎉', 'ok', 6000);
      if (booted && App.page === 'premium' && !Sheet.stack.length) render();
    } catch (e) { /* без оплаты переводом */ }
    this.payBusy = false;
  },
  // Админу: напомнить о новых заявках на оплату
  async adminPayPing() {
    try { const r = await this.call('admin-pay-list'); const n = (r.pending || []).length; App.adminPay = r; if (n) toast(`Новые оплаты на проверку: ${n}. Профиль → Пользователи`, 'warn', 7000); } catch (e) { /* не админ или офлайн */ }
  },
  payOn() { return !!(this.pay && this.pay.enabled) && !(Native.on && Native.isIOS) && !(Native.on && (this.offerings && (this.offerings.availablePackages || []).length)); },
  errText(e) {
    const c = e && e.code;
    return ({ auth: 'Войдите в аккаунт, чтобы получить Premium.', offline: 'Нет интернета.', trial_used: 'Пробный период уже был использован на этом аккаунте.',
      bad_code: 'Такого промокода нет или он закончился.', code_used: 'Этот промокод вы уже активировали.', not_configured: 'Оплата ещё не подключена.',
      rc_failed: 'Магазин не ответил — попробуйте позже.', too_many: 'Слишком много заявок за сутки. Попробуйте завтра.' })[c] || 'Не получилось. Попробуйте позже.';
  },

  /* ---------- Покупки в приложении (RevenueCat) ---------- */
  rcKey() { return Native.isIOS ? BILLING.revenuecatIos : BILLING.revenuecatAndroid; },
  async rcInit() {
    const P = Native.plugin('Purchases'); if (!P || !this.rcKey() || !this.signed()) return;
    try { await P.configure({ apiKey: this.rcKey(), appUserID: Supa.user.id }); this.rcReady = true; const o = await P.getOfferings(); this.offerings = o && o.current; } catch (e) { console.warn('rc', e); }
  },
  async rcBuy(pkg) {
    const P = Native.plugin('Purchases');
    try { await P.purchasePackage({ aPackage: pkg }); await this.call('rc-sync'); toast('Спасибо! Premium активирован 🎉'); render(); }
    catch (e) { if (!(e && (e.userCancelled || /cancel/i.test(e.message || e.code || '')))) toast('Покупка не прошла: ' + (e.message || e), 'err'); }
  },
};

/* Если функция платная — показать экран Premium и вернуть false */
function requirePremium(what) {
  if (Premium.active()) return true;
  const s = Sheet.open({ title: 'Это функция Premium', body: `<div class="prem-mini">${ic('spark', 28)}<p class="lead">${esc(what)} — в FORMA Premium.</p>
    <p class="muted">${Premium.st.trial_used ? 'Оформите Premium, чтобы пользоваться без ограничений.' : 'Попробуйте 7 дней бесплатно — без карты и автосписаний.'}</p></div>
    <button class="btn primary block mt12" data-k="go">${Premium.st.trial_used ? 'Подробнее о Premium' : 'Попробовать бесплатно'}</button>` });
  s.querySelector('[data-k=go]').onclick = () => { Sheet.closeAll(); go('premium'); };
  return false;
}
const premBadge = () => (Premium.active() ? `<span class="prem-badge">${ic('spark', 12)}Premium</span>` : '');

/* ---------- Страница Premium ---------- */
const PREM_FEATURES = [
  ['spark', 'AI: фото еды и «Описать словами»', '3 раза в день', '50 раз в день'],
  ['cal', 'Меню на день от AI под ваши цели', '—', 'да'],
  ['chart', 'Статистика за 90 дней и любой период', '7–30 дней', 'без ограничений'],
  ['sun', 'Цветовые темы', 'лайм', '5 цветов'],
  ['heart', 'Поддержка развития FORMA', '', '❤'],
];
function billingRegion() {
  let tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { /* нет Intl */ }
  if (/^Asia\/(Almaty|Qyzylorda|Aqtobe|Aqtau|Atyrau|Oral|Qostanay)$/.test(tz)) return 'KZ';
  if (/^(Europe\/(Moscow|Samara|Volgograd|Kirov|Ulyanovsk|Astrakhan|Saratov|Kaliningrad)|Asia\/(Yekaterinburg|Omsk|Novosibirsk|Barnaul|Tomsk|Novokuznetsk|Krasnoyarsk|Irkutsk|Chita|Yakutsk|Khandyga|Vladivostok|Ust-Nera|Magadan|Sakhalin|Srednekolymsk|Kamchatka|Anadyr))$/.test(tz)) return 'RU';
  if (/^Asia\/(Tashkent|Samarkand)$/.test(tz)) return 'UZ';
  return tz ? 'INT' : 'KZ';
}
function priceText(v) {
  const r = BILLING.regions[billingRegion()] || BILLING.regions.KZ;
  const n = r.cur === '$' ? (+v).toFixed(2) : fmt(v);
  return r.before ? `${r.cur}${n}` : `${n} ${r.cur}`;
}
function regionPrices() { return BILLING.regions[billingRegion()] || BILLING.regions.KZ; }

PAGES.premium = {
  title: 'Premium', icon: 'spark',
  mount() { if (Premium.signed()) Premium.loadPay(); },
  render() {
    const on = Premium.active(); const st = Premium.st; const signed = Premium.signed();
    const until = st.until ? new Date(st.until).toLocaleDateString({ en: 'en-US', kk: 'kk-KZ' }[I18N.lang] || 'ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
    const src = { trial: 'пробный период', admin: 'подарок', store: 'подписка' }[st.src] || (String(st.src || '').startsWith('promo') ? 'промокод' : '');
    const RP = regionPrices();
    const pkgs = Native.on && Premium.offerings ? Premium.offerings.availablePackages || [] : [];
    const P = Premium.pay || {}; const req = Premium.payReq;
    const kz = (v) => `${fmt(v)} ₸`;
    const reqBox = req && req.status === 'pending'
      ? `<div class="banner info mt12">${ic('timer', 18)}<div><b>Заявка ${esc(req.code)} на проверке</b><p class="muted sm">${req.plan === 'year' ? 'Год' : 'Месяц'} · ${kz(req.amount)}. Как только оплата придёт, Premium включится сам — обычно в течение дня.</p>
          <button class="btn sm ghost mt8" data-act="payCancel">Отменить заявку</button></div></div>`
      : req && req.status === 'rejected' ? `<div class="banner warn mt12">${ic('info', 18)}<div>Оплата по заявке ${esc(req.code)} не найдена. Если вы переводили деньги — напишите создателю FORMA.</div></div>` : '';
    const buy = Premium.payOn()
      ? `${reqBox}<div class="plans mt12"><button class="plan" data-act="payOpen" data-plan="month"><b>${kz(P.month)}</b><span>в месяц</span></button>
         <button class="plan best" data-act="payOpen" data-plan="year"><i>−${Math.round((1 - P.year / (P.month * 12)) * 100)}%</i><b>${kz(P.year)}</b><span>в год · ${kz(Math.round(P.year / 12))}/<span>мес</span></span></button></div>
         <p class="muted sm center mt8">Оплата переводом через ${esc(P.method || 'Kaspi')}. Без автосписаний — продлеваете сами, когда захотите.</p>`
      : Native.on
      ? (pkgs.length ? pkgs.map((p, i) => `<button class="btn ${i === 0 ? 'primary' : ''} block mt8" data-act="premiumBuy" data-i="${i}">${esc(p.product.title || p.identifier)} — ${esc(p.product.priceString)}</button>`).join('')
        : `<div class="banner info mt12">${ic('info', 18)}<div>Покупка в приложении появится после публикации в ${Native.isIOS ? 'App Store' : 'Google Play'}. А пока — пробный период или промокод.</div></div>`)
      : `<div class="plans mt12"><button class="plan" data-act="premiumBuy" data-plan="month"><b>${priceText(RP.month)}</b><span>в месяц</span></button>
         <button class="plan best" data-act="premiumBuy" data-plan="year"><i>−${Math.round((1 - RP.year / (RP.month * 12)) * 100)}%</i><b>${priceText(RP.year)}</b><span>в год · ${priceText(RP.cur === '$' ? Math.round(RP.year / 12 * 100) / 100 : Math.round(RP.year / 12))}/<span>мес</span></span></button></div>`;
    return `<section class="prem-hero fade"><div class="prem-ic">${ic('spark', 30)}</div><h1>FORMA Premium</h1>
        <p>${on ? `Активен до <b>${until}</b>${src ? ` · ${src}` : ''}` : 'Больше AI, меню под ваши цели и полная статистика'}</p></section>
      <section class="card fade"><div class="prem-table"><div class="ph"><span></span><b>Бесплатно</b><b class="acc">Premium</b></div>
        ${PREM_FEATURES.map(([icn, t, f, p]) => `<div class="pr"><span>${ic(icn, 16)}${esc(t)}</span><small class="muted">${esc(f)}</small><small class="acc">${esc(p)}</small></div>`).join('')}</div></section>
      ${!signed ? `<section class="card"><p class="lead">Premium привязан к аккаунту — так он работает на всех ваших устройствах.</p><button class="btn primary block mt12" data-act="signIn">${ic('user', 16)}Войти или создать аккаунт</button></section>`
        : `<section class="card fade">
        ${!on && !st.trial_used ? `<button class="btn primary block lg" data-act="premiumTrial">${ic('spark', 18)}Попробовать 7 дней бесплатно</button><p class="muted sm center mt8">Без карты. Через 7 дней просто станет бесплатная версия.</p>` : ''}
        ${on ? `<p class="muted center">${st.src === 'store' ? 'Управлять подпиской можно в настройках магазина приложений.' : 'Продлить можно в любой момент — дни сложатся.'}</p>` : ''}
        ${buy}
        <form class="row gap8 mt16" data-sub="premiumPromo"><input class="input grow" name="code" placeholder="Промокод" maxlength="30" autocapitalize="characters"><button class="btn">Применить</button></form>
        ${Native.on ? '<button class="btn ghost sm block mt8" data-act="premiumRestore">Восстановить покупки</button>' : ''}
      </section>`}
      <p class="muted sm center">Основные функции FORMA бесплатны всегда: дневник, база продуктов, сканер, шаги, вода, вес, тренировки.</p>`;
  },
};
ACT.premiumTrial = async (el) => {
  el.disabled = true;
  try { await Premium.call('trial'); toast('Premium на 7 дней включён 🎉'); render(); }
  catch (e) { toast(Premium.errText(e), 'err'); el.disabled = false; }
};
ACT.premiumPromo = async (f) => {
  const code = f.code.value.trim(); if (!code) { markInvalid(f.code, 'Введите промокод'); return; }
  try { const r = await Premium.call('redeem', { code }); toast(`Промокод принят: +${r.days} дн. Premium`); render(); }
  catch (e) { markInvalid(f.code, Premium.errText(e)); }
};
ACT.premiumBuy = async (el) => {
  if (Native.on) { const pkgs = (Premium.offerings && Premium.offerings.availablePackages) || []; const p = pkgs[+el.dataset.i]; if (p) Premium.rcBuy(p); return; }
  try { const r = await Premium.call('checkout', { plan: el.dataset.plan }); if (r && r.url) location.href = r.url; }
  catch (e) {
    Sheet.open({ title: 'Оплата картой — скоро', body: `<p class="lead">Оплата на сайте подключается.</p>
      <p class="muted">А пока Premium можно получить так:</p><ul class="recs"><li>${ic('spark', 18)}<span>${Premium.st.trial_used ? 'Пробный период уже использован' : '7 дней бесплатно — кнопка выше'}</span></li>
      <li>${ic('star', 18)}<span>Промокод — у создателя FORMA или в соцсетях приложения</span></li><li>${ic('download', 18)}<span>Покупка в приложении FORMA для iPhone и Android — после публикации в магазинах</span></li></ul>` });
  }
};
/* ---------- Оплата переводом (Kaspi): перевод → «Я оплатил» → создатель подтверждает ---------- */
ACT.payOpen = (el) => {
  const P = Premium.pay; if (!P) return; const plan = el.dataset.plan; const amount = plan === 'year' ? P.year : P.month;
  const code = Premium.payCode;
  const s = Sheet.open({ title: `Premium на ${plan === 'year' ? 'год' : 'месяц'} — ${fmt(amount)} ₸`, body: `
    <ol class="pay-steps">
      <li><b>Переведите ${fmt(amount)} ₸</b> через ${esc(P.method || 'Kaspi')}${P.phone ? ` по номеру<div class="pay-copy"><b>${esc(P.phone)}</b><button class="btn sm" data-copy="${esc(P.phone)}">Копировать</button></div>` : ''}
        ${P.name ? `<small class="muted">Получатель: ${esc(P.name)}</small>` : ''}
        ${P.link ? `<a class="btn block mt8" href="${esc(P.link)}" target="_blank" rel="noopener">${ic('right', 16)}Открыть оплату в ${esc(P.method || 'Kaspi')}</a>` : ''}</li>
      <li><b>В комментарии к переводу</b> напишите код:<div class="pay-copy"><b class="pay-code">${esc(code)}</b><button class="btn sm" data-copy="${esc(code)}">Копировать</button></div><small class="muted">По коду мы узнаем, чей это перевод.</small></li>
      <li><b>Нажмите «Я оплатил»</b> — Premium включится, как только оплата будет проверена (обычно в течение дня).</li>
    </ol>
    ${P.note ? `<p class="muted sm">${esc(P.note)}</p>` : ''}
    <label class="form mt12">Имя отправителя в ${esc(P.method || 'Kaspi')} <small class="muted">— необязательно, помогает найти перевод</small><input class="input" data-k="payer" maxlength="60" placeholder="например, Анвар З."></label>`,
    foot: `<button class="btn primary grow" data-k="paid">${ic('check', 18)}Я оплатил</button>` });
  s.querySelectorAll('[data-copy]').forEach((b) => { b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); toast('Скопировано'); } catch (e) { toast('Скопируйте вручную', 'warn'); } }; });
  s.querySelector('[data-k=paid]').onclick = async (e) => {
    e.target.disabled = true;
    try { const r = await Premium.call('pay-request', { plan, payer: s.querySelector('[data-k=payer]').value.trim() }); Premium.payReq = r.request; Sheet.closeAll(); render(); toast('Заявка отправлена. Premium включится после проверки оплаты.', 'ok', 6000); }
    catch (err) { toast(Premium.errText(err), 'err'); e.target.disabled = false; }
  };
};
ACT.payCancel = async () => {
  if (!(await confirmDlg('Отменить заявку на оплату? Если вы уже перевели деньги — не отменяйте, дождитесь проверки.', 'Отменить заявку'))) return;
  try { const r = await Premium.call('pay-cancel'); Premium.payReq = r.request; render(); } catch (e) { toast(Premium.errText(e), 'err'); }
};

ACT.premiumRestore = async () => {
  const P = Native.plugin('Purchases'); if (!P || !Premium.rcReady) { toast('Покупки в приложении пока не подключены', 'warn'); return; }
  try { await P.restorePurchases(); await Premium.call('rc-sync'); toast(Premium.active() ? 'Premium восстановлен' : 'Активных покупок не найдено'); render(); } catch (e) { toast(Premium.errText(e), 'err'); }
};

/* ---------- Меню на день от AI (Premium) ---------- */
ACT.aiMenu = () => {
  if (!AI.food) { aiOffSheet('Меню на день от AI'); return; }
  if (!requirePremium('Меню на день от AI')) return;
  const T = targets(); const tomorrow = addDays(todayISO(), 1);
  const s = Sheet.open({ title: 'Меню на день от AI', wide: true, body: `<p class="muted">Под ваши цели: ${fmt(T.kcal)} ккал · Б ${T.p} · Ж ${T.f} · У ${T.c}.</p>
    <form class="form mt12" data-k="f"><label>Пожелания <small class="muted">— необязательно</small><input class="input" name="prefs" maxlength="200" placeholder="напр.: без рыбы, бюджетно, побольше белка"></label>
    <button class="btn primary block">${ic('spark', 18)}Составить меню</button></form><div data-k="out" class="mt16"></div>` });
  const f = s.querySelector('[data-k=f]'); const out = s.querySelector('[data-k=out]');
  f.onsubmit = async (e) => {
    e.preventDefault(); const btn = f.querySelector('button'); btn.disabled = true; out.innerHTML = `<div class="loading">${ic('spark', 20)}Составляю меню… около 20–40 секунд</div>`;
    try {
      const data = await AI.task('menu', { targets: { kcal: T.kcal, p: T.p, f: T.f, c: T.c }, prefs: f.prefs.value.trim() });
      const meals = (data && data.meals) || []; const tot = zeroN();
      meals.forEach((m) => (m.items || []).forEach((x) => addN(tot, scaleN({ kcal: +x.kcal || 0, p: +x.p || 0, f: +x.f || 0, c: +x.c || 0, fib: +x.fib || 0, sug: 0, salt: 0 }, +x.grams || 0))));
      out.innerHTML = `${data.comment ? `<div class="banner info">${ic('info', 18)}<div>${esc(data.comment)}</div></div>` : ''}
        ${meals.map((m) => `<h4 class="mt12">${esc((MEALS.find((x) => x.id === m.meal) || {}).name || m.meal)}</h4><div class="list">${(m.items || []).map((x) => `<div class="li"><div class="grow"><b translate="no">${esc(x.name)}</b><small class="muted">${fmt(x.grams)} г</small></div><span>${fmt((+x.kcal || 0) * (+x.grams || 0) / 100)} ккал</span></div>`).join('')}</div>`).join('')}
        <div class="preview"><div class="pv-k"><b>${fmt(tot.kcal)}</b><span>ккал</span></div><div><b>${fmt(tot.p)}</b><span>белки</span></div><div><b>${fmt(tot.f)}</b><span>жиры</span></div><div><b>${fmt(tot.c)}</b><span>углеводы</span></div></div>
        <div class="f2 mt12"><label>В дневник на день<input class="input" type="date" data-k="d" value="${tomorrow}"></label><div></div></div>
        <button class="btn primary block mt12" data-k="add">${ic('plus', 18)}Добавить меню в дневник</button>`;
      out.querySelector('[data-k=add]').onclick = () => {
        const d = out.querySelector('[data-k=d]').value || tomorrow; let n = 0;
        meals.forEach((m) => (m.items || []).forEach((x) => { if (!x.name || !(+x.grams > 0)) return; addToDiary(d, MEALS.some((mm) => mm.id === m.meal) ? m.meal : 'snack', { id: 'ai_' + uid(), name: x.name, brand: 'Меню AI', per: { kcal: +x.kcal || 0, p: +x.p || 0, f: +x.f || 0, c: +x.c || 0, fib: +x.fib || 0, sug: 0, salt: 0 } }, r1(+x.grams)); n++; }));
        Sheet.closeAll(); App.diaryDate = d; go('diary'); toast(`Меню добавлено: ${n} продуктов на ${fmtDate(d).toLowerCase()}`);
      };
    } catch (err) { out.innerHTML = `<div class="banner warn">${esc(err && err.code === 'premium_required' ? 'Нужен Premium' : AI.errText(err))}</div>`; }
    btn.disabled = false;
  };
};

/* Ненавязчивый баннер на главной: только для вошедших без Premium, можно скрыть */
function premiumNudgeHTML() {
  if (!Premium.signed() || Premium.active()) return '';
  try { if (+localStorage.getItem(LS + 'premNudge') > Date.now()) return ''; } catch (e) { /* нет хранилища */ }
  return `<div class="banner prem fade">${ic('spark', 20)}<div class="grow"><b>FORMA Premium</b><p class="muted sm">${Premium.st.trial_used ? 'AI 50 раз в день, меню от AI и полная статистика.' : '7 дней бесплатно: AI без ограничений, меню от AI и полная статистика.'}</p>
    <a class="btn primary sm mt8" href="#premium">${Premium.st.trial_used ? 'Подробнее' : 'Попробовать'}</a></div><button class="icon-btn sm" data-act="premNudgeHide" aria-label="Скрыть">${ic('x', 16)}</button></div>`;
}
ACT.premNudgeHide = () => { try { localStorage.setItem(LS + 'premNudge', String(Date.now() + 14 * 864e5)); } catch (e) { /* нет хранилища */ } render(); };
