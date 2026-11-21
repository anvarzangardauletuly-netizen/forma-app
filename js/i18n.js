/* FORMA — языки интерфейса (ru / kk / en).
   Исходный текст интерфейса — русский. Переводы лежат в data/i18n.json: { "русская фраза": ["english", "қазақша"] }.
   Переводчик следит за DOM (MutationObserver) и подменяет текстовые узлы и атрибуты placeholder/title/aria-label.
   Названия продуктов из базы не переводятся (элементы с translate="no" пропускаются). */
const I18N = {
  LANGS: [['ru', 'Русский'], ['kk', 'Қазақша'], ['en', 'English']],
  KEY: 'forma:lang',
  lang: 'ru',
  dict: null,
  cache: new Map(),
  orig: new WeakMap(),
  done: new WeakMap(),
  phraseRe: null,
  phraseMap: null,
  ATTRS: ['placeholder', 'title', 'aria-label'],
  CYR: /[А-Яа-яЁё]/,

  detect() {
    let saved = null;
    try { saved = localStorage.getItem(this.KEY); } catch (e) { /* приватный режим */ }
    if (saved && this.LANGS.some(([k]) => k === saved)) return saved;
    const nav = ((navigator.languages && navigator.languages[0]) || navigator.language || 'ru').toLowerCase();
    if (nav.startsWith('kk')) return 'kk';
    if (/^(ru|uk|be|ky|uz|tg|hy|az|ka|mo|ro-md)/.test(nav)) return 'ru';
    return 'en';
  },

  async init() {
    this.lang = this.detect();
    document.documentElement.lang = this.lang;
    if (this.lang === 'ru') return;
    try {
      const r = await fetch('data/i18n.json?v=5');
      this.dict = await r.json();
    } catch (e) { this.dict = null; return; }
    this.buildPhrases();
    this.localizeDates();
    this.wrapDialogs();
    this.translateTree(document.body);
    document.title = this.t(document.title);
    new MutationObserver((list) => this.onMutations(list)).observe(document.body, {
      childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: this.ATTRS,
    });
  },

  set(lang) {
    try { localStorage.setItem(this.KEY, lang); } catch (e) { /* без сохранения */ }
    location.reload();
  },

  col() { return this.lang === 'en' ? 0 : 1; },

  buildPhrases() {
    // Шаблоны с числами: «Белок: {0} из {1} г» — ключи словаря с {0}, {1}…
    // Частичная замена внутри длинных строк — только фразы из нескольких слов, длинные — первыми.
    const c = this.col();
    const keys = Object.keys(this.dict).filter((k) => k.length >= 8 && k.includes(' ') && !k.includes('{') && this.CYR.test(k)).sort((a, b) => b.length - a.length);
    this.phraseMap = new Map(keys.map((k) => [k, this.dict[k][c]]));
    const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    this.phraseRe = keys.length ? new RegExp(`(?<![А-Яа-яЁёA-Za-z])(${keys.map(esc).join('|')})(?![А-Яа-яЁёA-Za-z])`, 'g') : null;
  },

  NUM: /\d+(?:[\s\u00a0\u202f]\d{3})*(?:[.,]\d+)?/g,

  look(s) {
    const v = this.dict[s];
    if (v) return v[this.col()];
    if (!/\d/.test(s)) return null;
    const nums = [];
    const key = s.replace(this.NUM, (x) => `{${nums.push(x) - 1}}`);
    const t = this.dict[key];
    return t ? t[this.col()].replace(/\{(\d+)\}/g, (x, i) => nums[+i] ?? x) : null;
  },

  // Перевод строки: целиком → без знаков по краям → шаблон с числами → по фразам внутри.
  t(s) {
    if (!this.dict || !s || !this.CYR.test(s)) return s;
    if (this.cache.has(s)) return this.cache.get(s);
    let out = null;
    const m = s.match(/^(\s*)([\s\S]*?)(\s*)$/);
    const core = m[2];
    const hit = this.look(core);
    if (hit != null) out = m[1] + hit + m[3];
    if (out == null) {
      const a = core.match(/^([\s.,:;+\-–—−×%№#()\/«»"'·•✦⚠→←↑↓≈~*!?…₸$€]*)([\s\S]*?)([\s.,:;+\-–—−×%()\/«»"'·•✦→≈~*!?…₸$€]*)$/);
      if (a && a[2] && a[2] !== core) { const h = this.look(a[2]); if (h != null) out = m[1] + a[1] + h + a[3] + m[3]; }
    }
    if (out == null) {
      // число в начале или в конце: «12 мин», «Цель 8 000»
      const b = core.match(/^([\d\s\u00a0\u202f.,:+\-–—−×%≈~]*)([\s\S]*?)([\s\u00a0\u202f\d.,:%+\-–—−×≈~]*)$/);
      if (b && b[2] && b[2] !== core) { const h = this.look(b[2]); if (h != null) out = m[1] + b[1] + h + b[3] + m[3]; }
    }
    if (out == null) out = this.phraseRe ? s.replace(this.phraseRe, (x) => this.phraseMap.get(x) ?? x) : s;
    if (this.cache.size > 5000) this.cache.clear();
    this.cache.set(s, out);
    return out;
  },

  skip(el, forAttrs) {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      if (n.nodeType !== 1) continue;
      const tag = n.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || n.isContentEditable) return true;
      if (tag === 'TEXTAREA' && !(forAttrs && n === el)) return true;
      if (n.getAttribute('translate') === 'no') return true;
    }
    return false;
  },

  textNode(node) {
    const cur = node.data;
    if (!this.CYR.test(cur) || this.done.get(node) === cur) return;
    if (node.parentElement && this.skip(node.parentElement)) return;
    const tr = this.t(cur);
    if (tr !== cur) { this.orig.set(node, cur); this.done.set(node, tr); node.data = tr; }
  },

  attrs(el) {
    if (this.skip(el, true)) return;
    for (const a of this.ATTRS) {
      const v = el.getAttribute(a);
      if (!v || !this.CYR.test(v)) continue;
      const mark = 'i18n' + a.replace(/[^a-z]/g, '');
      if (el.dataset[mark] === v) continue;
      const tr = this.t(v);
      if (tr !== v) { el.dataset[mark] = tr; el.setAttribute(a, tr); }
    }
    if (el.tagName === 'INPUT' && (el.type === 'button' || el.type === 'submit') && this.CYR.test(el.value)) el.value = this.t(el.value);
  },

  translateTree(root) {
    if (!root) return;
    if (root.nodeType === 3) { this.textNode(root); return; }
    if (root.nodeType !== 1) return;
    if (this.skip(root)) return;
    this.attrs(root);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        if (n.nodeType === 1) {
          const tag = n.tagName;
          if (tag === 'TEXTAREA') { this.attrs(n); return NodeFilter.FILTER_REJECT; }
          if (tag === 'SCRIPT' || tag === 'STYLE' || n.getAttribute('translate') === 'no') return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
        return this.CYR.test(n.data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });
    const els = []; const texts = [];
    while (w.nextNode()) (w.currentNode.nodeType === 1 ? els : texts).push(w.currentNode);
    els.forEach((e) => this.attrs(e));
    texts.forEach((t) => this.textNode(t));
  },

  onMutations(list) {
    for (const m of list) {
      if (m.type === 'childList') m.addedNodes.forEach((n) => this.translateTree(n));
      else if (m.type === 'characterData') this.textNode(m.target);
      else if (m.type === 'attributes') this.attrs(m.target);
    }
  },

  // Месяцы и дни недели — прямо в массивах core.js, чтобы даты собирались уже на нужном языке.
  localizeDates() {
    const L = {
      en: {
        m: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
        wd: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'], wdf: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
      },
      kk: {
        m: ['қаңтар', 'ақпан', 'наурыз', 'сәуір', 'мамыр', 'маусым', 'шілде', 'тамыз', 'қыркүйек', 'қазан', 'қараша', 'желтоқсан'],
        mn: ['Қаңтар', 'Ақпан', 'Наурыз', 'Сәуір', 'Мамыр', 'Маусым', 'Шілде', 'Тамыз', 'Қыркүйек', 'Қазан', 'Қараша', 'Желтоқсан'],
        wd: ['Жс', 'Дс', 'Сс', 'Ср', 'Бс', 'Жм', 'Сб'], wdf: ['Жексенбі', 'Дүйсенбі', 'Сейсенбі', 'Сәрсенбі', 'Бейсенбі', 'Жұма', 'Сенбі'],
      },
    }[this.lang];
    if (!L) return;
    const put = (arr, src) => { if (Array.isArray(arr) && src) src.forEach((v, i) => { arr[i] = v; }); };
    try { put(MONTHS, L.m); put(MONTHS_N, L.mn || L.m); put(WD, L.wd); put(WD_FULL, L.wdf); } catch (e) { /* нет массивов */ }
  },

  wrapDialogs() {
    const self = this;
    ['alert', 'confirm', 'prompt'].forEach((fn) => {
      const orig = window[fn];
      if (typeof orig !== 'function') return;
      window[fn] = function (msg, ...rest) { return orig.call(window, typeof msg === 'string' ? self.t(msg) : msg, ...rest); };
    });
  },

  // Для текста, который уходит не в DOM (уведомления, буфер обмена, AI-подсказки).
  tr(s) { return this.lang === 'ru' ? s : this.t(s); },

  pickerHTML() {
    return `<div class="seg lang-seg" translate="no">${this.LANGS.map(([k, n]) => `<button type="button" class="${this.lang === k ? 'on' : ''}" data-act="setLang" data-v="${k}">${n}</button>`).join('')}</div>`;
  },
};
const tr = (s) => I18N.tr(s);
if (typeof ACT !== 'undefined') ACT.setLang = (el) => { if (el.dataset.v !== I18N.lang) I18N.set(el.dataset.v); };
