#!/usr/bin/env python3
"""Импорт магазинных товаров из полной выгрузки Open Food Facts (CSV, ODbL) в data/foods-off.json.

Файл выгрузки (~1 ГБ в gzip) читается потоком прямо из сети и на диск не сохраняется:
оставляем только товары, продающиеся в Казахстане или России, с правдоподобным КБЖУ и названием.
Запуск: python3 scripts/import_off_dump.py
"""
import csv, gzip, io, json, os, re, sys, datetime, urllib.request

URL = "https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz"
UA = "FORMA-import/1.0 (open-source calorie tracker)"
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "foods-off.json")
COUNTRIES = ("en:kazakhstan", "en:russia")
CYR = re.compile(r"[а-яёәіңғүұқөһ]", re.I)
csv.field_size_limit(10 ** 8)


def num(v):
    try:
        x = float(v)
        return x if x == x else None
    except (TypeError, ValueError):
        return None


def clean(s, n=90):
    return re.sub(r"\s+", " ", str(s or "")).strip(" ,.;-")[:n]


def convert(r):
    tags = r.get("countries_tags") or ""
    if not any(c in tags for c in COUNTRIES):
        return None
    kcal = num(r.get("energy-kcal_100g"))
    if kcal is None and num(r.get("energy_100g")) is not None:
        kcal = num(r.get("energy_100g")) / 4.184
    if kcal is None:
        return None
    pr, fa, ca = num(r.get("proteins_100g")), num(r.get("fat_100g")), num(r.get("carbohydrates_100g"))
    if None in (pr, fa, ca):
        if [pr, fa, ca].count(None) == 3 and kcal > 5:
            return None
        pr, fa, ca = pr or 0.0, fa or 0.0, ca or 0.0
    if not (0 <= kcal <= 950 and 0 <= pr <= 100 and 0 <= fa <= 100 and 0 <= ca <= 100 and pr + fa + ca <= 102):
        return None
    if kcal > 30 and abs(pr * 4 + fa * 9 + ca * 4 - kcal) / kcal > 0.45:
        return None
    name = ""
    for k in ("product_name_ru", "product_name", "generic_name"):
        if CYR.search(str(r.get(k) or "")):
            name = clean(r.get(k)); break
    if not name:
        name = clean(r.get("product_name"))
    if len(name) < 3:
        return None
    brand = clean(str(r.get("brands") or "").split(",")[0], 40)
    fib = max(0.0, num(r.get("fiber_100g")) or 0.0)
    sug = max(0.0, min(ca, num(r.get("sugars_100g")) or 0.0))
    salt = max(0.0, min(100.0, num(r.get("salt_100g")) or 0.0))
    serv = num(r.get("serving_quantity"))
    serv = round(serv) if serv and 1 <= serv <= 2000 else 100
    code = re.sub(r"\D", "", str(r.get("code") or ""))
    if not (8 <= len(code) <= 14):
        return None
    rr = lambda x: round(x, 1)
    kz = "en:kazakhstan" in tags
    pop = int(num(r.get("unique_scans_n")) or 0) + (1000 if kz else 0)  # товары Казахстана — выше в выдаче
    return [code, name, brand, rr(kcal), rr(pr), rr(fa), rr(ca), rr(fib), rr(sug), rr(salt), serv, pop]


def main():
    req = urllib.request.Request(URL, headers={"User-Agent": UA})
    resp = urllib.request.urlopen(req, timeout=300)
    text = io.TextIOWrapper(gzip.GzipFile(fileobj=resp), encoding="utf-8", errors="replace", newline="")
    reader = csv.DictReader(text, delimiter="\t", quoting=csv.QUOTE_NONE)
    items, seen_code, seen_key, rows = [], set(), set(), 0
    for r in reader:
        rows += 1
        if rows % 200000 == 0:
            print(f"прочитано {rows:,} строк, отобрано {len(items):,}", file=sys.stderr, flush=True)
        x = convert(r)
        if not x or x[0] in seen_code:
            continue
        key = (x[1].lower().replace("ё", "е"), x[2].lower(), round(x[3]))
        if key in seen_key:
            continue
        seen_code.add(x[0]); seen_key.add(key); items.append(x)
    items.sort(key=lambda x: -x[11])
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"v": datetime.date.today().isoformat(), "src": "Open Food Facts (ODbL), страны: Казахстан, Россия", "items": items},
                  f, ensure_ascii=False, separators=(",", ":"))
    print(f"готово: {len(items):,} товаров из {rows:,} строк → {OUT}", file=sys.stderr)


if __name__ == "__main__":
    main()
