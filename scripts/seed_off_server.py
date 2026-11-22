#!/usr/bin/env python3
"""Загрузка частей из import_off_server.py в таблицу off_products (Supabase).

Загрузка идёт через временную функцию public.seed_off(rows, token): токен лежит в app_settings
и удаляется вместе с функцией после импорта. Публичный ключ Supabase — из js/account.js.
Запуск: OUT_DIR=/tmp/off-server SEED_TOKEN=… python3 scripts/seed_off_server.py
"""
import glob, json, os, re, sys, time, urllib.request

ROOT = os.path.join(os.path.dirname(__file__), "..")
SRC = open(os.path.join(ROOT, "js", "account.js"), encoding="utf-8").read()
URL = re.search(r"SUPA_URL = '([^']+)'", SRC).group(1)
KEY = re.search(r"SUPA_KEY = '([^']+)'", SRC).group(1)
OUT_DIR = os.environ.get("OUT_DIR") or "/tmp/off-server"
TOKEN = os.environ["SEED_TOKEN"]
START = int(os.environ.get("START") or 0)


def post(rows):
    body = json.dumps({"rows": rows, "token": TOKEN}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(f"{URL}/rest/v1/rpc/seed_off", data=body, method="POST",
                                 headers={"apikey": KEY, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read() or b"0")


def main():
    parts = sorted(glob.glob(os.path.join(OUT_DIR, "part-*.json")))
    total = 0
    for i, path in enumerate(parts):
        if i < START:
            continue
        rows = json.load(open(path, encoding="utf-8"))
        for attempt in range(4):
            try:
                total += int(post(rows)); break
            except Exception as e:  # noqa: BLE001
                print(f"{os.path.basename(path)}: ошибка {e}, повтор {attempt + 1}", file=sys.stderr, flush=True)
                time.sleep(3 * (attempt + 1))
        else:
            print(f"остановлено на {path} (START={i})", file=sys.stderr); sys.exit(1)
        if i % 10 == 0:
            print(f"{i + 1}/{len(parts)} частей, загружено {total:,}", file=sys.stderr, flush=True)
    print(f"готово: {total:,} строк", file=sys.stderr)


if __name__ == "__main__":
    main()
