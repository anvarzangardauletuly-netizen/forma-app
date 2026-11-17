# FORMA

Приложение для питания, КБЖУ, веса и тренировок. Статический сайт (без сборки): Vercel отдаёт файлы как есть.

- `index.html`, `css/`, `js/`, `icons/`, `manifest.webmanifest`, `sw.js`
- Облако и вход: Supabase (`js/account.js`)

## Еда по фото и «описать словами» (AI)

- Серверная функция Supabase `food-ai` (`supabase/functions/food-ai/index.ts`) — оценивает КБЖУ по фото тарелки, по фото этикетки и по описанию блюда.
- Работает только для вошедших пользователей, лимит — 40 запросов в день на человека (таблица `ai_usage`, `supabase/migrations/`).
- Нужен секрет `ANTHROPIC_API_KEY` в Supabase: Project Settings → Edge Functions → Secrets.
