// Рисует исходники иконки и заставки приложения в resources/ (для `npm run assets`).
// Запуск: node scripts/make-app-assets.js   (нужен Playwright с Chromium)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'resources');

function letterPath(scale, s = 512) {
  const H = 344 * scale, W = 244 * scale, stem = 96 * scale, top = 86 * scale, midY = 140 * scale, midH = 78 * scale, midW = 206 * scale;
  const X = (s - W) / 2 + 6 * scale, Y = (s - H) / 2, R = 24 * scale, ri = 12 * scale;
  return [`M${X + R},${Y}`, `H${X + W - R}`, `A${R},${R} 0 0 1 ${X + W},${Y + R}`, `V${Y + top - R}`, `A${R},${R} 0 0 1 ${X + W - R},${Y + top}`,
    `H${X + stem + ri}`, `A${ri},${ri} 0 0 0 ${X + stem},${Y + top + ri}`, `V${Y + midY - ri}`, `A${ri},${ri} 0 0 0 ${X + stem + ri},${Y + midY}`,
    `H${X + midW - R}`, `A${R},${R} 0 0 1 ${X + midW},${Y + midY + R}`, `V${Y + midY + midH - R}`, `A${R},${R} 0 0 1 ${X + midW - R},${Y + midY + midH}`,
    `H${X + stem + ri}`, `A${ri},${ri} 0 0 0 ${X + stem},${Y + midY + midH + ri}`, `V${Y + H - R}`, `A${R},${R} 0 0 1 ${X + stem - R},${Y + H}`,
    `H${X + R}`, `A${R},${R} 0 0 1 ${X},${Y + H - R}`, `V${Y + R}`, `A${R},${R} 0 0 1 ${X + R},${Y}`, 'Z'].join(' ');
}
const DEFS = `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d9ff4a"/><stop offset="1" stop-color="#b6e01f"/></linearGradient>
  <linearGradient id="ink" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a1a1a"/><stop offset="1" stop-color="#050505"/></linearGradient></defs>`;
const svg = ({ bg = true, letter = true, scale = 1, rx = 0 }) => `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">${DEFS}
  ${bg ? `<rect width="512" height="512" rx="${rx}" fill="url(#bg)"/>` : ''}${letter ? `<path fill="url(#ink)" d="${letterPath(scale)}"/>` : ''}</svg>`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch(); const p = await b.newPage();
  const shot = async (name, size, html, transparent = false) => {
    await p.setViewportSize({ width: size, height: size });
    await p.setContent(`<html><body style="margin:0;background:${transparent ? 'transparent' : '#000'}">${html}</body></html>`);
    await p.screenshot({ path: path.join(OUT, name), clip: { x: 0, y: 0, width: size, height: size }, omitBackground: transparent });
  };
  const big = (s) => s.replace('width="512" height="512"', 'width="1024" height="1024"');
  await shot('icon-only.png', 1024, big(svg({})));                                     // iOS и обычная иконка Android
  await shot('icon-foreground.png', 1024, big(svg({ bg: false, scale: 0.72 })), true); // адаптивная иконка Android: буква
  await shot('icon-background.png', 1024, big(svg({ letter: false })));                // адаптивная иконка Android: фон
  // Заставка: тёмный фон и иконка со скруглением по центру
  const splash = (size) => `<div style="width:${size}px;height:${size}px;background:#0b0b0b;display:flex;align-items:center;justify-content:center">
    <div style="width:${Math.round(size * 0.22)}px;height:${Math.round(size * 0.22)}px;border-radius:22%;overflow:hidden">${svg({}).replace('width="512" height="512"', 'width="100%" height="100%"')}</div></div>`;
  await shot('splash.png', 2732, splash(2732)); await shot('splash-dark.png', 2732, splash(2732));
  await b.close(); console.log('resources/ готова');
})();
