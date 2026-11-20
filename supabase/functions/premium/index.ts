// FORMA — «premium»: статус подписки, пробный период, промокоды, покупки в приложении, админ-инструменты.
// Статус хранится в auth.users.app_metadata (premium_until, premium_src, trial_used) — пользователь не может изменить его сам.
//
// Действия (POST JSON { action, ... }, заголовок Authorization: Bearer <JWT пользователя>):
//   status                      — текущий статус
//   trial                       — 7 дней бесплатно (один раз на аккаунт)
//   redeem   { code }           — промокод
//   rc-sync                     — проверить покупку в App Store / Google Play через RevenueCat (нужен секрет REVENUECAT_SECRET)
//   checkout { plan }           — оплата на сайте (провайдер подключается позже: Kaspi / CloudPayments / ioka)
//   admin-grant { user_id, days }  — только для админа (таблица public.admins)
//   admin-stats                 — только для админа: пользователи, активные, Premium
import { createClient } from "npm:@supabase/supabase-js@2";

const TRIAL_DAYS = 7;
// Промокоды: КОД → дни. Меняйте здесь (и передеплойте функцию). Регистр не важен.
const PROMO: Record<string, { days: number; until?: string }> = {
  "FORMA2026": { days: 30, until: "2027-06-30" },
  "DRUG7": { days: 7 },
  "NISFORMA": { days: 30, until: "2027-06-30" },
};

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const DAY = 864e5;

function statusOf(meta: Record<string, unknown>) {
  const until = typeof meta.premium_until === "string" ? meta.premium_until : null;
  const active = !!until && Date.parse(until) > Date.now();
  return { premium: active, until, src: meta.premium_src || null, trial_used: !!meta.trial_used, promos: (meta.promos as string[]) || [] };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "bad_request" }, 405);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: who, error: authErr } = await db.auth.getUser(token);
  if (authErr || !who?.user) return json({ error: "auth" }, 401);
  const user = who.user; const meta = { ...(user.app_metadata || {}) } as Record<string, unknown>;
  let body: Record<string, unknown> = {}; try { body = await req.json(); } catch { /* пусто */ }
  const action = String(body.action || "status");

  const extend = async (days: number, src: string, extra: Record<string, unknown> = {}) => {
    const base = Math.max(Date.now(), Date.parse(String(meta.premium_until || 0)) || 0);
    const next = { ...meta, ...extra, premium_until: new Date(base + days * DAY).toISOString(), premium_src: src };
    const { error } = await db.auth.admin.updateUserById(user.id, { app_metadata: next });
    if (error) throw error;
    Object.assign(meta, next);
  };
  const isAdmin = async () => { const { data } = await db.from("admins").select("user_id").eq("user_id", user.id).maybeSingle(); return !!data; };

  try {
    if (action === "status") return json({ ok: true, ...statusOf(meta) });

    if (action === "trial") {
      if (meta.trial_used) return json({ error: "trial_used", ...statusOf(meta) }, 409);
      await extend(TRIAL_DAYS, "trial", { trial_used: true });
      return json({ ok: true, ...statusOf(meta) });
    }

    if (action === "redeem") {
      const code = String(body.code || "").trim().toUpperCase().replace(/\s+/g, "");
      const p = PROMO[code];
      if (!p || (p.until && Date.now() > Date.parse(p.until))) return json({ error: "bad_code" }, 404);
      const used = (meta.promos as string[]) || [];
      if (used.includes(code)) return json({ error: "code_used", ...statusOf(meta) }, 409);
      await extend(p.days, "promo:" + code, { promos: [...used, code] });
      return json({ ok: true, days: p.days, ...statusOf(meta) });
    }

    if (action === "rc-sync") {
      // Проверка покупки на стороне RevenueCat: appUserID в приложении = id пользователя Supabase
      const secret = Deno.env.get("REVENUECAT_SECRET");
      if (!secret) return json({ error: "not_configured" }, 503);
      const r = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(user.id)}`, { headers: { Authorization: `Bearer ${secret}` } });
      if (!r.ok) return json({ error: "rc_failed", status: r.status }, 502);
      const j = await r.json();
      const ent = j?.subscriber?.entitlements?.premium;
      const exp = ent?.expires_date ? Date.parse(ent.expires_date) : (ent ? Date.now() + 3650 * DAY : 0);
      if (exp > Date.now()) {
        const next = { ...meta, premium_until: new Date(exp).toISOString(), premium_src: "store" };
        const { error } = await db.auth.admin.updateUserById(user.id, { app_metadata: next }); if (error) throw error; Object.assign(meta, next);
      }
      return json({ ok: true, ...statusOf(meta) });
    }

    if (action === "checkout") {
      // Здесь будет создание платежа у провайдера (Kaspi Pay / CloudPayments / ioka) после регистрации ИП.
      return json({ error: "not_configured" }, 503);
    }

    if (action === "admin-grant") {
      if (!(await isAdmin())) return json({ error: "forbidden" }, 403);
      const uid = String(body.user_id || ""); const days = Math.max(-3650, Math.min(3650, Math.round(Number(body.days) || 0)));
      if (!uid || !days) return json({ error: "bad_request" }, 400);
      const { data: t, error: e1 } = await db.auth.admin.getUserById(uid); if (e1 || !t?.user) return json({ error: "not_found" }, 404);
      const m = { ...(t.user.app_metadata || {}) } as Record<string, unknown>;
      const base = days > 0 ? Math.max(Date.now(), Date.parse(String(m.premium_until || 0)) || 0) : (Date.parse(String(m.premium_until || 0)) || Date.now());
      const next = { ...m, premium_until: new Date(base + days * DAY).toISOString(), premium_src: "admin" };
      const { error: e2 } = await db.auth.admin.updateUserById(uid, { app_metadata: next }); if (e2) throw e2;
      return json({ ok: true, ...statusOf(next) });
    }

    if (action === "admin-stats") {
      if (!(await isAdmin())) return json({ error: "forbidden" }, 403);
      const users: Array<Record<string, unknown>> = []; let page = 1;
      for (;;) { const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 }); if (error) throw error; users.push(...(data.users as unknown as Array<Record<string, unknown>>)); if (data.users.length < 1000) break; page++; }
      const now = Date.now(); const since = (ms: number) => users.filter((u) => Date.parse(String(u.last_sign_in_at || 0)) > now - ms).length;
      const { data: seen } = await db.from("members").select("last_seen");
      const active = (ms: number) => (seen || []).filter((m) => Date.parse(String(m.last_seen || 0)) > now - ms).length;
      const premium = users.filter((u) => statusOf((u.app_metadata || {}) as Record<string, unknown>).premium);
      const premiumMap = Object.fromEntries(premium.map((u) => [u.id as string, statusOf((u.app_metadata || {}) as Record<string, unknown>)]));
      return json({ ok: true, users: users.length, new7: users.filter((u) => Date.parse(String(u.created_at)) > now - 7 * DAY).length,
        active1: active(DAY), active7: active(7 * DAY), signin7: since(7 * DAY), premium: premium.length,
        trial: premium.filter((u) => (u.app_metadata as Record<string, unknown>).premium_src === "trial").length, premiumMap });
    }

    return json({ error: "bad_request" }, 400);
  } catch (e) { console.error("premium", e); return json({ error: "server", message: String((e as Error)?.message || e) }, 500); }
});
