// FORMA — серверная функция «food-ai»: оценка КБЖУ по фото еды, по этикетке и по описанию блюда.
// Вызывается из приложения (supabase.functions.invoke) только вошедшими пользователями.
// Ключ Claude API хранится в секретах Supabase (ANTHROPIC_API_KEY) и в браузер не попадает.
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

const FREE_LIMIT = 3;     // AI-запросов в день без Premium
const PREMIUM_LIMIT = 50; // с Premium
const MAX_IMAGE_B64 = 4_500_000; // ~3,3 МБ JPEG

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const ITEM = {
  type: "object",
  properties: {
    name: { type: "string", description: "название продукта или блюда на русском" },
    grams: { type: "number", description: "масса этой части в граммах" },
    kcal: { type: "number", description: "ккал на 100 г" },
    p: { type: "number", description: "белки, г на 100 г" },
    f: { type: "number", description: "жиры, г на 100 г" },
    c: { type: "number", description: "углеводы, г на 100 г" },
    fib: { type: "number", description: "клетчатка, г на 100 г" },
  },
  required: ["name", "grams", "kcal", "p", "f", "c", "fib"],
  additionalProperties: false,
};
const MEAL_SCHEMA = {
  type: "object",
  properties: {
    items: { type: "array", items: ITEM },
    comment: { type: "string", description: "коротко по-русски: что могло быть оценено неточно" },
  },
  required: ["items", "comment"],
  additionalProperties: false,
};
const MENU_SCHEMA = {
  type: "object",
  properties: {
    meals: { type: "array", items: { type: "object", properties: {
      meal: { type: "string", enum: ["breakfast", "lunch", "dinner", "snack"] },
      items: { type: "array", items: ITEM },
    }, required: ["meal", "items"], additionalProperties: false } },
    comment: { type: "string", description: "1–2 предложения по-русски: почему меню такое" },
  },
  required: ["meals", "comment"],
  additionalProperties: false,
};
const LABEL_SCHEMA = {
  type: "object",
  properties: {
    found: { type: "boolean", description: "есть ли на фото таблица пищевой ценности" },
    name: { type: "string" }, brand: { type: "string" },
    kcal: { type: "number" }, p: { type: "number" }, f: { type: "number" }, c: { type: "number" },
    fib: { type: "number" }, sug: { type: "number" }, salt: { type: "number" },
    portion_g: { type: "number" },
    confidence: { type: "string", enum: ["high", "low"] },
  },
  required: ["found", "name", "brand", "kcal", "p", "f", "c", "fib", "sug", "salt", "portion_g", "confidence"],
  additionalProperties: false,
};

const SYSTEM = `Ты — нутрициолог в приложении FORMA (подсчёт калорий). Оцениваешь пищевую ценность по типичным табличным данным (USDA, Скурихин и т. п.).
Все значения kcal/p/f/c/fib — НА 100 г продукта в том виде, в каком он на фото или в описании (готовый, варёный, жареный). Граммы — реальная масса порции.
Названия — короткие и понятные, на русском. Учитывай видимое масло, соусы, сахар. Если не уверен — дай самую вероятную оценку и скажи об этом в comment.`;

function clean(s: unknown, max = 300) {
  return String(s ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
}

// Язык ответа: названия и комментарии — на языке интерфейса пользователя.
const LANG_NOTE: Record<"ru" | "kk" | "en", string> = {
  ru: "",
  kk: "\nВажно: все тексты в ответе (name, comment) пиши на казахском языке, даже если выше сказано «на русском».",
  en: "\nImportant: write all texts in the answer (name, comment) in English, even if the instructions above say Russian.",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "bad_request" }, 405);

  // 1) Пользователь должен быть вошедшим
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: who, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !who?.user) return json({ error: "auth" }, 401);

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "not_configured" }, 503);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const task = String(body.task || "");
  const image = typeof body.image === "string" ? body.image.replace(/^data:image\/\w+;base64,/, "") : "";
  if (!["photo", "label", "text", "menu"].includes(task)) return json({ error: "bad_request" }, 400);
  if (task !== "text" && task !== "menu" && (!image || image.length > MAX_IMAGE_B64)) return json({ error: "bad_request", message: "image" }, 400);
  if (task === "text" && !clean(body.text)) return json({ error: "bad_request", message: "text" }, 400);

  // 2) Premium и дневной лимит на пользователя
  const premium = Date.parse(String((who.user.app_metadata || {}).premium_until || 0)) > Date.now();
  if (task === "menu" && !premium) return json({ error: "premium_required" }, 402);
  const DAILY_LIMIT = premium ? PREMIUM_LIMIT : FREE_LIMIT;
  const { data: used, error: limErr } = await admin.rpc("ai_bump", { p_user: who.user.id, p_limit: DAILY_LIMIT });
  if (limErr) return json({ error: "ai_failed", message: "limit check" }, 500);
  if (used === -1) return json({ error: "limit", limit: DAILY_LIMIT, premium }, 429);

  // 3) Запрос к Claude
  const grams = Number(body.grams) > 0 && Number(body.grams) <= 5000 ? Math.round(Number(body.grams)) : null;
  const hint = clean(body.hint, 200);
  const lang = (["ru", "kk", "en"].includes(String(body.lang)) ? String(body.lang) : "ru") as "ru" | "kk" | "en";
  let content: Anthropic.Beta.BetaContentBlockParam[];
  let schema: Record<string, unknown>;
  if (task === "photo") {
    schema = MEAL_SCHEMA;
    content = [
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
      { type: "text", text: `Определи все продукты и блюда на фото, оцени массу каждого и пищевую ценность на 100 г.
${grams ? `Пользователь взвесил: вся еда на фото весит ${grams} г — распредели эту массу между позициями.` : "Массу оцени по размеру тарелки, приборов и упаковок."}
${hint ? `Подсказка пользователя о блюде: «${hint}».` : ""}
Если еды на фото нет — верни пустой items и объясни в comment.` },
    ];
  } else if (task === "label") {
    schema = LABEL_SCHEMA;
    content = [
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
      { type: "text", text: `Это фото упаковки. Найди таблицу пищевой ценности и перепиши значения на 100 г (если указано на порцию — пересчитай на 100 г).
name — название продукта на русском, brand — производитель (или пустая строка), portion_g — масса упаковки или порции (или 100).
Если таблицы нет — found=false, остальные числа 0.` },
    ];
  } else if (task === "menu") {
    schema = MENU_SCHEMA;
    const t = (body.targets || {}) as Record<string, unknown>; const n = (k: string) => Math.max(0, Math.min(10000, Math.round(Number(t[k]) || 0)));
    content = [{ type: "text", text: `Составь меню на один день для подсчёта калорий.
Цели на день: ${n("kcal")} ккал, белки ${n("p")} г, жиры ${n("f")} г, углеводы ${n("c")} г. Отклонение по калориям — не больше 5%.
Приёмы пищи: завтрак, обед, ужин и 1 перекус (meal = breakfast, lunch, dinner, snack).
Еда — простая и доступная в Казахстане (крупы, курица, говядина, рыба, яйца, творог, кефир, овощи, фрукты, хлеб, местные блюда). Граммы — реальные порции.
${clean(body.prefs, 300) ? `Пожелания пользователя: «${clean(body.prefs, 300)}».` : ""}
Для каждого продукта — масса и пищевая ценность на 100 г.` }];
  } else {
    schema = MEAL_SCHEMA;
    content = [{ type: "text", text: `Пользователь описал, что съел: «${clean(body.text, 300)}».${grams ? ` Общая масса: ${grams} г.` : ""}
Разбери описание на продукты/блюда (обычно 1–4 позиции), оцени массу каждого (если масса не указана — типичная порция) и пищевую ценность на 100 г.
Это может быть блюдо любой кухни мира или товар из магазина — используй типичную рецептуру/состав.` }];
  }

  try {
    const client = new Anthropic({ apiKey: key });
    const msg = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: task === "menu" ? 8000 : 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM + LANG_NOTE[lang],
      output_config: { effort: "low", format: { type: "json_schema", schema } },
      messages: [{ role: "user", content }],
    } as any);
    if (msg.stop_reason === "refusal") return json({ error: "refused" }, 422);
    const text = msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    const data = JSON.parse(text);
    return json({ ok: true, data, used, limit: DAILY_LIMIT, premium });
  } catch (e) {
    const status = (e as any)?.status;
    console.error("claude error", status, (e as any)?.message);
    if (status === 401 || status === 403) return json({ error: "not_configured" }, 503);
    if (status === 429 || status === 529) return json({ error: "busy" }, 503);
    return json({ error: "ai_failed" }, 502);
  }
});
