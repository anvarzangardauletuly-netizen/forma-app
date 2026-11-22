// FORMA — «premium»: статус подписки, пробный период, промокоды, покупки в приложении, оплата переводом, админ-инструменты.
// Статус хранится в auth.users.app_metadata (premium_until, premium_src, trial_used) — пользователь не может изменить его сам.
//
// Действия (POST JSON { action, ... }, заголовок Authorization: Bearer <JWT пользователя>):
//   status                      — текущий статус
//   trial                       — 7 дней бесплатно (один раз на аккаунт)
//   redeem   { code }           — промокод
//   rc-sync                     — проверить покупку в App Store / Google Play через RevenueCat (нужен секрет REVENUECAT_SECRET)
//   checkout { plan }           — оплата картой на сайте (провайдер подключается позже)
//   admin-grant { user_id, days }  — только для админа (таблица public.admins)
//   admin-stats                 — только для админа: пользователи, активные, Premium
//   pay-info                    — реквизиты для оплаты переводом (Kaspi), цены и своя заявка
//   pay-request { plan, payer } — «Я оплатил»: заявка, которую админ подтверждает
//   pay-cancel                  — отменить свою заявку
//   admin-pay-list              — заявки и настройки оплаты (админ)
//   admin-pay-decide { id, approve } — подтвердить (включает Premium) или отклонить (админ)
//   admin-pay-settings { ... }  — реквизиты и цены (админ)
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
const PLAN_DAYS: Record<string, number> = { month: 30, year: 365 };
const PAY_DEFAULT = { enabled: false, method: "Kaspi", phone: "", name: "", link: "", note: "", month: 1290, year: 7990, currency: "KZT" };
const clean = (v: unknown, max = 120) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, " ").trim().slice(0, max);

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

    // ---------- Оплата переводом: заявка → подтверждение админом ----------
    const paySettings = async () => {
      const { data } = await db.from("app_settings").select("value").eq("key", "pay").maybeSingle();
      return { ...PAY_DEFAULT, ...((data?.value as Record<string, unknown>) || {}) } as typeof PAY_DEFAULT;
    };
    const publicPay = (p: typeof PAY_DEFAULT) => ({ enabled: !!p.enabled && !!(p.phone || p.link), method: p.method, phone: p.phone, name: p.name, link: p.link, note: p.note, month: p.month, year: p.year, currency: p.currency });
    const myPending = async () => {
      const { data } = await db.from("pay_requests").select("id, plan, amount, currency, code, status, created_at, decided_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1);
      return (data && data[0]) || null;
    };

    // Код для комментария к переводу — постоянный для пользователя, чтобы его можно было указать заранее
    const payCode = "F" + String(10000 + (parseInt(user.id.replace(/-/g, "").slice(0, 8), 16) % 90000));

    if (action === "pay-info") {
      const p = await paySettings();
      return json({ ok: true, pay: publicPay(p), code: payCode, request: await myPending(), ...statusOf(meta) });
    }

    if (action === "pay-request") {
      const p = await paySettings(); const pub = publicPay(p);
      if (!pub.enabled) return json({ error: "not_configured" }, 503);
      const plan = String(body.plan || "");
      if (!PLAN_DAYS[plan]) return json({ error: "bad_request" }, 400);
      const last = await myPending();
      if (last && last.status === "pending") return json({ ok: true, request: last, pay: pub });
      const { count } = await db.from("pay_requests").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", new Date(Date.now() - DAY).toISOString());
      if ((count || 0) >= 5) return json({ error: "too_many" }, 429);
      const code = payCode;
      const { data, error } = await db.from("pay_requests").insert({ user_id: user.id, email: user.email || null, plan, amount: plan === "year" ? p.year : p.month, currency: p.currency, code, payer: clean(body.payer, 80) || null })
        .select("id, plan, amount, currency, code, status, created_at, decided_at").single();
      if (error) throw error;
      return json({ ok: true, request: data, pay: pub });
    }

    if (action === "pay-cancel") {
      await db.from("pay_requests").update({ status: "cancelled", decided_at: new Date().toISOString() }).eq("user_id", user.id).eq("status", "pending");
      return json({ ok: true, request: await myPending() });
    }

    if (action === "admin-pay-list") {
      if (!(await isAdmin())) return json({ error: "forbidden" }, 403);
      const { data: pending } = await db.from("pay_requests").select("*").eq("status", "pending").order("created_at", { ascending: true }).limit(100);
      const { data: recent } = await db.from("pay_requests").select("*").neq("status", "pending").order("decided_at", { ascending: false }).limit(20);
      const { data: sum } = await db.from("pay_requests").select("amount, currency").eq("status", "approved");
      const total = (sum || []).reduce((a, r) => a + (r.currency === "KZT" ? Number(r.amount) || 0 : 0), 0);
      return json({ ok: true, pending: pending || [], recent: recent || [], total, settings: await paySettings() });
    }

    if (action === "admin-pay-decide") {
      if (!(await isAdmin())) return json({ error: "forbidden" }, 403);
      const id = Number(body.id); const approve = body.approve === true;
      const { data: r } = await db.from("pay_requests").select("*").eq("id", id).maybeSingle();
      if (!r) return json({ error: "not_found" }, 404);
      if (r.status !== "pending") return json({ error: "already", request: r }, 409);
      // Сначала «забираем» заявку (только если она ещё pending) — двойное нажатие не продлит Premium дважды
      const { data: upd } = await db.from("pay_requests").update({ status: approve ? "approved" : "rejected", decided_at: new Date().toISOString() }).eq("id", id).eq("status", "pending").select("*").maybeSingle();
      if (!upd) return json({ error: "already" }, 409);
      if (approve) {
        try {
          const { data: t, error: e1 } = await db.auth.admin.getUserById(r.user_id); if (e1 || !t?.user) throw e1 || new Error("user not found");
          const m = { ...(t.user.app_metadata || {}) } as Record<string, unknown>;
          const base = Math.max(Date.now(), Date.parse(String(m.premium_until || 0)) || 0);
          const next = { ...m, premium_until: new Date(base + (PLAN_DAYS[r.plan] || 30) * DAY).toISOString(), premium_src: "pay" };
          const { error: e2 } = await db.auth.admin.updateUserById(r.user_id, { app_metadata: next }); if (e2) throw e2;
        } catch (e) {
          await db.from("pay_requests").update({ status: "pending", decided_at: null }).eq("id", id);
          throw e;
        }
      }
      return json({ ok: true, request: upd });
    }

    if (action === "admin-pay-settings") {
      if (!(await isAdmin())) return json({ error: "forbidden" }, 403);
      const num = (v: unknown, d: number) => { const n = Math.round(Number(v)); return n > 0 && n < 10_000_000 ? n : d; };
      const cur = await paySettings();
      const value = { enabled: body.enabled === true, method: clean(body.method, 30) || "Kaspi", phone: clean(body.phone, 30), name: clean(body.name, 60), link: /^https:\/\//.test(String(body.link || "")) ? clean(body.link, 300) : "", note: clean(body.note, 300), month: num(body.month, cur.month), year: num(body.year, cur.year), currency: "KZT" };
      const { error } = await db.from("app_settings").upsert({ key: "pay", value, updated_at: new Date().toISOString() }); if (error) throw error;
      return json({ ok: true, settings: value });
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
