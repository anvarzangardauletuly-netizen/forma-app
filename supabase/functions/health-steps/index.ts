// FORMA — «health-steps»: приём шагов из «Здоровья» (iPhone) через приложение «Команды».
// Команда по расписанию открывает ссылку вида
//   https://<project>.supabase.co/functions/v1/health-steps?t=<личный токен>&n=<шаги за сегодня>
// Токен создаётся в приложении (Шаги → «Шаги из „Здоровья“ автоматически»); в базе хранится только его SHA-256
// в документе пользователя `health-token`. Шаги пишутся в документ `health-YYYY-MM-DD`, приложение подхватывает их само.
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const text = (body: string, status = 200) => new Response(body, { status, headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8" } });

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function todayIn(tz: string) {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
  catch { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
}
// «8 432», «8432,0», «8432.0» → 8432
function parseSteps(v: unknown) {
  const s = String(v ?? "").replace(/[\s  ]/g, "").replace(",", ".");
  const m = s.match(/^\d+(\.\d+)?/); if (!m) return NaN;
  return Math.round(parseFloat(m[0]));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  let p: Record<string, unknown> = Object.fromEntries(url.searchParams);
  if (req.method === "POST") { try { p = { ...p, ...(await req.json()) }; } catch { /* только параметры ссылки */ } }

  const token = String(p.t ?? "");
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) return text("FORMA: неверная ссылка. Создайте новую в приложении: Шаги → «Здоровье».", 400);
  const n = parseSteps(p.n);
  if (!Number.isFinite(n) || n < 0 || n > 150000) return text("FORMA: нет количества шагов (параметр n).", 400);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(p.d ?? "")) ? String(p.d) : todayIn(String(p.tz ?? "Asia/Almaty"));

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const hash = await sha256(token);
  const { data: owner, error: e1 } = await db.from("docs").select("user_id").eq("key", "health-token").eq("data->>hash", hash).limit(1).maybeSingle();
  if (e1) { console.error(e1); return text("FORMA: ошибка сервера, попробуйте позже.", 500); }
  if (!owner) return text("FORMA: ссылка устарела. Создайте новую в приложении: Шаги → «Здоровье».", 403);

  const key = "health-" + date;
  const { data: prev } = await db.from("docs").select("data").eq("user_id", owner.user_id).eq("key", key).maybeSingle();
  const prevSteps = prev && prev.data && Number.isFinite(+prev.data.steps) ? +prev.data.steps : -1;
  // за день шаги в «Здоровье» только растут; меньшее число — запоздалый запуск, его не берём (кроме явного d=)
  const steps = p.d ? n : Math.max(n, prevSteps);
  const now = new Date().toISOString();
  const { error: e2 } = await db.from("docs").upsert({ user_id: owner.user_id, key, data: { kind: "health", date, steps, at: now }, updated_at: now });
  if (e2) { console.error(e2); return text("FORMA: не удалось сохранить, попробуйте позже.", 500); }
  return text(`FORMA: ${steps} шагов за ${date} сохранено.`);
});
