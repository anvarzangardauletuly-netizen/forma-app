// Копирует файлы сайта в www/ — из этой папки Capacitor собирает приложение.
// Сайт на Vercel по-прежнему отдаётся из корня репозитория, сборка для него не нужна.
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'www');
const items = ['index.html', 'privacy.html', 'offer.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'icons', 'data'];
if (existsSync(out)) rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const it of items) cpSync(join(root, it), join(out, it), { recursive: true });
console.log('www/ готова:', items.join(', '));
