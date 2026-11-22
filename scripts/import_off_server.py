#!/usr/bin/env python3
"""Большая серверная база продуктов FORMA (до 500 000 товаров) из полной выгрузки Open Food Facts (CSV, ODbL).

Выгрузка (~1 ГБ gzip, ~5 млн строк) читается потоком из сети. Берём товары с правдоподобным КБЖУ,
штрихкодом и читаемым названием. Приоритет: Казахстан → страны СНГ / русское название → самые сканируемые в мире.
Результат — файлы part-0000.json … (по 5 000 строк) в OUT_DIR, их загружает scripts/seed_off_server.sh.

Запуск: OUT_DIR=/tmp/off python3 scripts/import_off_server.py   (LIMIT=500000 по умолчанию)
"""
import csv, gzip, heapq, io, json, os, re, sys, urllib.request

sys.path.insert(0, os.path.dirname(__file__))
from import_off_dump import URL, UA, COUNTRIES, CYR, num, clean  # noqa: E402

LIMIT = int(os.environ.get("LIMIT") or 500_000)
OUT_DIR = os.environ.get("OUT_DIR") or "/tmp/off-server"
PART = 5000
# Префиксы штрихкодов GS1 (страна, выдавшая код)
KZ_PREFIX = ("487",)
CIS_PREFIXES = tuple(str(x) for x in range(460, 470)) + ("481", "482", "470", "478", "476", "484", "485", "486", "488", "474", "475", "477")
IMPORT_PREFIXES = ("868", "869") + tuple(str(x) for x in range(690, 700)) + ("880", "626", "400", "401", "402", "403", "404", "405", "406", "407", "408", "409", "410", "411", "412", "413", "414", "415", "416", "417", "418", "419", "420", "421", "422", "423", "424", "425", "426", "427", "428", "429", "440", "590", "594", "599", "858", "859", "800", "801", "802", "803", "804", "805", "806", "807", "808", "809", "810", "811", "812", "813", "814", "815", "816", "817", "818", "819", "820", "821", "822", "823", "824", "825", "826", "827", "828", "829", "830", "831", "832", "833", "834", "835", "836", "837", "838", "839", "529", "520", "521", "759", "750", "754", "755", "780", "784", "896", "890", "899", "885", "893", "955", "958", "950", "471", "489", "729", "622", "628", "629", "460")
READABLE = re.compile(r"[a-zа-яёәіңғүұқөһ]", re.I)
csv.field_size_limit(10 ** 8)


def convert(r):
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
            name = clean(r.get(k), 120); break
    if not name:
        name = clean(r.get("product_name") or r.get("generic_name"), 120)
    name = re.sub(r"[\x00-\x1f\x7f]", " ", name).strip()
    if len(name) < 3 or not READABLE.search(name):
        return None
    code = re.sub(r"\D", "", str(r.get("code") or ""))
    if not (8 <= len(code) <= 14):
        return None
    brand = re.sub(r"[\x00-\x1f\x7f]", " ", clean(str(r.get("brands") or "").split(",")[0], 60)).strip()
    fib = max(0.0, num(r.get("fiber_100g")) or 0.0)
    sug = max(0.0, min(ca, num(r.get("sugars_100g")) or 0.0))
    salt = max(0.0, min(100.0, num(r.get("salt_100g")) or 0.0))
    serv = num(r.get("serving_quantity"))
    serv = round(serv) if serv and 1 <= serv <= 2000 else 100
    tags = r.get("countries_tags") or ""
    scans = int(num(r.get("unique_scans_n")) or 0)
    kz = "en:kazakhstan" in tags or code.startswith(KZ_PREFIX)
    cis = kz or any(c in tags for c in COUNTRIES) or bool(CYR.search(name)) or code.startswith(CIS_PREFIXES)
    imp = code.startswith(IMPORT_PREFIXES)
    # приоритет: Казахстан → СНГ/русские названия → страны, откуда везут товары в Казахстан → популярность в мире
    score = (3 if kz else 2 if cis else 1 if imp else 0, scans)
    rr = lambda x: round(x, 1)
    row = {"code": code, "name": name, "brand": brand, "kcal": rr(kcal), "p": rr(pr), "f": rr(fa), "c": rr(ca),
           "fib": rr(fib), "sug": rr(sug), "salt": rr(salt), "portion": serv, "scans": scans + (100000 if kz else 0),
           "cc": "kz" if kz else ("cis" if cis else ("imp" if imp else ""))}
    return score, row


def main():
    req = urllib.request.Request(URL, headers={"User-Agent": UA})
    resp = urllib.request.urlopen(req, timeout=300)
    text = io.TextIOWrapper(gzip.GzipFile(fileobj=resp), encoding="utf-8", errors="replace", newline="")
    reader = csv.DictReader(text, delimiter="\t", quoting=csv.QUOTE_NONE)
    heap, seen, rows, ok, tie = [], set(), 0, 0, 0
    for r in reader:
        rows += 1
        if rows % 250000 == 0:
            print(f"прочитано {rows:,}, подходящих {ok:,}, в отборе {len(heap):,}", file=sys.stderr, flush=True)
        x = convert(r)
        if not x or x[1]["code"] in seen:
            continue
        seen.add(x[1]["code"]); ok += 1; tie += 1
        item = (x[0], tie, x[1])
        if len(heap) < LIMIT:
            heapq.heappush(heap, item)
        elif item[0] > heap[0][0]:
            heapq.heapreplace(heap, item)
    items = [it[2] for it in sorted(heap, key=lambda t: (t[0], t[1]), reverse=True)]
    os.makedirs(OUT_DIR, exist_ok=True)
    for i in range(0, len(items), PART):
        with open(os.path.join(OUT_DIR, f"part-{i // PART:04d}.json"), "w", encoding="utf-8") as f:
            json.dump(items[i:i + PART], f, ensure_ascii=False, separators=(",", ":"))
    kz = sum(1 for x in items if x["cc"] == "kz"); cis = sum(1 for x in items if x["cc"] == "cis")
    print(f"готово: {len(items):,} товаров (Казахстан {kz:,}, СНГ {cis:,}) из {rows:,} строк, подходящих {ok:,} → {OUT_DIR}", file=sys.stderr)


if __name__ == "__main__":
    main()
