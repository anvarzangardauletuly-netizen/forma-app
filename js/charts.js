/* ============================================================
   FORMA — собственные SVG-графики (без внешних библиотек)
   ring(): кольцевой индикатор; line(): линия с перекрестием и подсказкой;
   bars(): столбцы с подсказкой и линией цели. Все — адаптивные.
   ============================================================ */
'use strict';

const Charts = {
  reg: [],
  reset() { this.reg = []; },
  mount(el, fn) { if (!el) return; this.reg.push({ el, fn }); fn(el); },
  redraw() { this.reg = this.reg.filter((r) => document.body.contains(r.el)); this.reg.forEach((r) => r.fn(r.el)); },

  ring({ value = 0, max = 1, size = 120, stroke = 10, color = 'var(--accent)', label = '', sub = '', over = false, cls = '' }) {
    const r = (size - stroke) / 2; const c = 2 * Math.PI * r;
    const pct = max > 0 ? clamp(value / max, 0, 1) : 0;
    const off = c * (1 - pct);
    return `<div class="ring ${cls}" style="width:${size}px;height:${size}px">
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(label)} ${esc(sub)}">
        <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--track)" stroke-width="${stroke}"/>
        <circle class="ring-val" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${over ? 'var(--over)' : color}" stroke-width="${stroke}"
          stroke-linecap="round" stroke-dasharray="${c}" style="--c:${c};--off:${off}" stroke-dashoffset="${off}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
      </svg>
      <div class="ring-txt">${label ? `<b>${label}</b>` : ''}${sub ? `<span>${sub}</span>` : ''}</div>
    </div>`;
  },

  bar(value, max, color = 'var(--accent)') {
    const pct = max > 0 ? clamp(value / max * 100, 0, 100) : 0;
    return `<div class="pbar"><i style="width:${pct}%;background:${value > max * 1.05 && max > 0 ? 'var(--over)' : color}"></i></div>`;
  },

  _frame(el, height) {
    const w = Math.max(240, el.clientWidth || 320); const h = height;
    return { w, h, pad: { l: 40, r: 12, t: 14, b: 26 } };
  },
  _ticks(min, max, n = 4) {
    if (min === max) { min -= 1; max += 1; }
    const span = max - min; const step0 = span / n; const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) || mag * 10;
    const lo = Math.floor(min / step) * step; const hi = Math.ceil(max / step) * step;
    const out = []; for (let v = lo; v <= hi + step / 2; v += step) out.push(+v.toFixed(6));
    return { lo, hi, ticks: out, step };
  },
  _labelEvery(n, w) { const fit = Math.max(2, Math.floor(w / 56)); return Math.max(1, Math.ceil(n / fit)); },

  /* line: {labels:[], series:[{name, values:[num|null], color}], unit, height, target, decimals, zeroBase} */
  line(el, o) {
    const { w, h, pad } = this._frame(el, o.height || 220);
    const n = o.labels.length;
    const all = o.series.flatMap((s) => s.values.filter((v) => v != null && Number.isFinite(v)));
    if (o.target) all.push(o.target);
    if (!all.length || n === 0) { el.innerHTML = `<div class="chart-empty">${o.empty || 'Нет данных за этот период'}</div>`; return; }
    let mn = Math.min(...all), mx = Math.max(...all);
    if (o.zeroBase) mn = 0; else { const p = (mx - mn) * 0.15 || 1; mn -= p; mx += p; }
    const { lo, hi, ticks } = this._ticks(mn, mx);
    const X = (i) => pad.l + (n === 1 ? (w - pad.l - pad.r) / 2 : i * (w - pad.l - pad.r) / (n - 1));
    const Y = (v) => pad.t + (h - pad.t - pad.b) * (1 - (v - lo) / (hi - lo || 1));
    const dec = o.decimals ?? 0;
    let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="chart">`;
    ticks.forEach((t) => { svg += `<line x1="${pad.l}" x2="${w - pad.r}" y1="${Y(t)}" y2="${Y(t)}" class="grid"/><text x="${pad.l - 6}" y="${Y(t) + 4}" class="ax" text-anchor="end">${fmt(t, dec)}</text>`; });
    const every = this._labelEvery(n, w);
    o.labels.forEach((l, i) => { if ((i % every === 0 && n - 1 - i >= every * 0.7) || i === n - 1) svg += `<text x="${X(i)}" y="${h - 6}" class="ax" text-anchor="middle">${esc(l)}</text>`; });
    if (o.target) svg += `<line x1="${pad.l}" x2="${w - pad.r}" y1="${Y(o.target)}" y2="${Y(o.target)}" class="target"/><text x="${w - pad.r}" y="${Y(o.target) - 5}" class="ax" text-anchor="end">цель ${fmt(o.target, dec)}</text>`;
    o.series.forEach((s) => {
      let d = ''; let pen = false;
      s.values.forEach((v, i) => { if (v == null || !Number.isFinite(v)) { if (!o.connect) pen = false; return; } d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); pen = true; });
      if (s.area) {
        const pts = s.values.map((v, i) => [v, i]).filter(([v]) => v != null);
        if (pts.length > 1) svg += `<path d="M${X(pts[0][1])} ${h - pad.b} ${pts.map(([v, i]) => `L${X(i)} ${Y(v)}`).join(' ')} L${X(pts[pts.length - 1][1])} ${h - pad.b}Z" fill="${s.color}" opacity=".12"/>`;
      }
      svg += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" class="draw"/>`;
      const pts = s.values.map((v, i) => [v, i]).filter(([v]) => v != null);
      if (pts.length <= 40) pts.forEach(([v, i]) => { svg += `<circle cx="${X(i)}" cy="${Y(v)}" r="3.5" fill="${s.color}" stroke="var(--card)" stroke-width="2"/>`; });
    });
    svg += `<line class="xhair" x1="0" x2="0" y1="${pad.t}" y2="${h - pad.b}" style="display:none"/><rect class="hit" x="${pad.l}" y="0" width="${w - pad.l - pad.r}" height="${h}" fill="transparent"/></svg>`;
    el.innerHTML = svg + '<div class="tip" style="display:none"></div>';
    this._hover(el, n, X, (i) => {
      const rows = o.series.map((s) => s.values[i] == null ? '' : `<div><i style="background:${s.color}"></i>${esc(s.name)}: <b>${fmt(s.values[i], dec)}</b> ${esc(o.unit || '')}</div>`).join('');
      return rows ? `<div class="tip-h">${esc(o.tipLabels ? o.tipLabels[i] : o.labels[i])}</div>${rows}` : '';
    });
  },

  /* bars: {labels:[], values:[], color, colors:[], unit, target, height, decimals, stacks:[{name,color,values}]} */
  bars(el, o) {
    const { w, h, pad } = this._frame(el, o.height || 200);
    const n = o.labels.length;
    const totals = o.stacks ? o.labels.map((_, i) => o.stacks.reduce((s, st) => s + (st.values[i] || 0), 0)) : o.values.map((v) => v || 0);
    const mxv = Math.max(...totals, o.target || 0);
    if (!n || mxv <= 0) { el.innerHTML = `<div class="chart-empty">${o.empty || 'Нет данных за этот период'}</div>`; return; }
    const { hi, ticks, step } = this._ticks(0, mxv * 1.08);
    const Y = (v) => pad.t + (h - pad.t - pad.b) * (1 - v / hi);
    const slot = (w - pad.l - pad.r) / n; const bw = Math.max(3, Math.min(34, slot * 0.62));
    const X = (i) => pad.l + slot * i + slot / 2;
    const dec = o.decimals ?? 0;
    let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="chart">`;
    ticks.forEach((t) => { svg += `<line x1="${pad.l}" x2="${w - pad.r}" y1="${Y(t)}" y2="${Y(t)}" class="grid"/><text x="${pad.l - 6}" y="${Y(t) + 4}" class="ax" text-anchor="end">${fmt(t, step < 1 ? 1 : 0)}</text>`; });
    const every = this._labelEvery(n, w);
    o.labels.forEach((l, i) => { if ((i % every === 0 && n - 1 - i >= every * 0.7) || i === n - 1) svg += `<text x="${X(i)}" y="${h - 6}" class="ax" text-anchor="middle">${esc(l)}</text>`; });
    const rr = Math.min(4, bw / 2);
    const barPath = (x, y0, y1, round) => { // y0 — низ, y1 — верх
      const hh = y0 - y1; if (hh <= 0.5) return '';
      const r = round ? Math.min(rr, hh) : 0;
      return `M${x - bw / 2} ${y0} V${y1 + r} Q${x - bw / 2} ${y1} ${x - bw / 2 + r} ${y1} H${x + bw / 2 - r} Q${x + bw / 2} ${y1} ${x + bw / 2} ${y1 + r} V${y0} Z`;
    };
    if (o.stacks) {
      o.labels.forEach((_, i) => {
        let acc = 0; const top = o.stacks.map((st) => st.values[i] || 0).reduce((a, v, k) => (v > 0 ? k : a), -1);
        o.stacks.forEach((st, k) => {
          const v = st.values[i] || 0; if (v <= 0) return;
          const y0 = Y(acc) - (acc > 0 ? 1 : 0); const y1 = Y(acc + v); acc += v;
          svg += `<path d="${barPath(X(i), y0, y1, k === top)}" fill="${st.color}" class="grow"/>`;
        });
      });
    } else {
      o.values.forEach((v, i) => {
        if (!v) return;
        const col = o.colors ? o.colors[i] : (o.target && v > o.target * 1.05 ? 'var(--over)' : (o.color || 'var(--accent)'));
        svg += `<path d="${barPath(X(i), Y(0), Y(v), true)}" fill="${col}" class="grow"/>`;
      });
    }
    if (o.target) svg += `<line x1="${pad.l}" x2="${w - pad.r}" y1="${Y(o.target)}" y2="${Y(o.target)}" class="target"/><text x="${w - pad.r}" y="${Y(o.target) - 5}" class="ax" text-anchor="end">цель ${fmt(o.target)}</text>`;
    svg += `<rect class="hl" x="0" y="${pad.t}" width="${slot}" height="${h - pad.t - pad.b}" style="display:none"/><rect class="hit" x="${pad.l}" y="0" width="${w - pad.l - pad.r}" height="${h}" fill="transparent"/></svg>`;
    el.innerHTML = svg + '<div class="tip" style="display:none"></div>';
    this._hover(el, n, X, (i) => {
      const head = `<div class="tip-h">${esc(o.tipLabels ? o.tipLabels[i] : o.labels[i])}</div>`;
      if (o.stacks) return head + o.stacks.map((st) => `<div><i style="background:${st.color}"></i>${esc(st.name)}: <b>${fmt(st.values[i] || 0, dec)}</b> ${esc(o.unit || '')}</div>`).join('') + `<div>Всего: <b>${fmt(totals[i], dec)}</b> ${esc(o.unit || '')}</div>`;
      return head + `<div>${o.values[i] ? `<b>${fmt(o.values[i], dec)}</b> ${esc(o.unit || '')}` : 'нет данных'}</div>`;
    }, slot);
  },

  _hover(el, n, X, html, slot) {
    const svg = el.querySelector('svg'); const tip = el.querySelector('.tip');
    const xh = svg.querySelector('.xhair'); const hl = svg.querySelector('.hl'); const hit = svg.querySelector('.hit');
    const show = (ev) => {
      const rect = svg.getBoundingClientRect();
      const px = (ev.clientX - rect.left) * (svg.viewBox.baseVal.width / rect.width);
      let best = 0, bd = Infinity; for (let i = 0; i < n; i++) { const d = Math.abs(X(i) - px); if (d < bd) { bd = d; best = i; } }
      const content = html(best); if (!content) { hide(); return; }
      tip.innerHTML = content; tip.style.display = 'block';
      if (xh) { xh.setAttribute('x1', X(best)); xh.setAttribute('x2', X(best)); xh.style.display = ''; }
      if (hl) { hl.setAttribute('x', X(best) - slot / 2); hl.style.display = ''; }
      const sx = X(best) * rect.width / svg.viewBox.baseVal.width;
      const tw = tip.offsetWidth; let left = sx + 12; if (left + tw > rect.width) left = sx - tw - 12;
      tip.style.left = Math.max(0, left) + 'px'; tip.style.top = '6px';
    };
    const hide = () => { tip.style.display = 'none'; if (xh) xh.style.display = 'none'; if (hl) hl.style.display = 'none'; };
    hit.addEventListener('pointermove', show); hit.addEventListener('pointerdown', show); hit.addEventListener('pointerleave', hide);
  },

  spark(values, color = 'var(--accent)', w = 120, h = 36) {
    const v = values.filter((x) => x != null); if (v.length < 2) return '';
    const mn = Math.min(...v), mx = Math.max(...v); const sp = mx - mn || 1;
    const pts = values.map((x, i) => (x == null ? null : [i * w / (values.length - 1), h - 3 - (x - mn) / sp * (h - 6)])).filter(Boolean);
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="spark"><path d="${pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('')}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  },
};
let _rsz; window.addEventListener('resize', () => { clearTimeout(_rsz); _rsz = setTimeout(() => Charts.redraw(), 150); });
