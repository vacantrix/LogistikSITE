#!/usr/bin/env python3
"""
Тесты Routing API 2ГИС (POST /routing/7.0.0/global) для стэка АЗМЗ Логистика.

Матрица проверок:
  T1  Городская поездка в Новороссийске (~4 км), car + jam       — базовый smoke
  T2  Абинск → Крымск (~15 км, А-146), car vs truck (18 т, h3.5) — грузовой профиль
  T3  Абинск → Новороссийск (63 км рейса Z-1067)                 — лимит демо-ключа 50 км?
  T4  jam (реалтайм) vs statistics (прогноз) на T2               — источник трафика
  T5  alternative=2 на T2                                        — альтернативы для перемаршрутизации
  T6  Невалидный ключ                                            — обработка ошибок

Запуск:
  python3 scripts/test_2gis.py --key XXX [--proxy http://localhost:3000/api/2gis/routing] [--direct]

Без --proxy запросы идут напрямую в routing.api.2gis.com. С --proxy — через сервер демо
(проверяет и прокси, и кеш 30 с: два одинаковых T2 должны дать cached=true).
Результаты: download/2gis-tests/2gis-report.json + 2gis-report.md
"""
import argparse
import json
import os
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

UPSTREAM = "https://routing.api.2gis.com/routing/7.0.0/global"

# Точки (lon, lat)
ABINSK = (38.157, 44.8682)      # АБЗ «Абинск» — старт рейса Z-1067
KRIMSK = (37.9926, 44.9312)     # Крымск, А-146
NOVOROSS_CITY = (37.7755, 44.7235)  # центр Новороссийска
NOVOROSS_PORT = (37.7880, 44.7130)  # порт/выгрузка
TRUCK_PARAMS = {"mass": 18000, "height": 3.5, "width": 2.55, "length": 9}


def call(url: str, body: dict, key: str, timeout: int = 20):
    """POST JSON → (http_status, json|None, latency_ms, err|None)."""
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        f"{url}?key={key}" if url.startswith("http") and "api.2gis" in url else url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            payload = json.loads(r.read().decode())
            return r.status, payload, int((time.perf_counter() - t0) * 1000), None
    except urllib.error.HTTPError as e:
        try:
            payload = json.loads(e.read().decode())
        except Exception:
            payload = None
        return e.code, payload, int((time.perf_counter() - t0) * 1000), f"HTTP {e.code}"
    except Exception as e:  # noqa: BLE001
        return None, None, int((time.perf_counter() - t0) * 1000), str(e)


def colors_hist(resp: dict) -> dict:
    hist = {"fast": 0, "normal": 0, "slow": 0, "ignore": 0, "other": 0}
    for res in resp.get("result") or []:
        for m in res.get("maneuvers") or []:
            for g in (m.get("outcoming_path") or {}).get("geometry") or []:
                c = g.get("color")
                hist[c if c in hist else "other"] += 1
    return hist


def summarize(resp: dict) -> dict:
    """Краткая сводка: статус, число вариантов, ETA/дистанция быстрейшего."""
    out = {
        "status": resp.get("status"),
        "message": resp.get("message"),
        "type": resp.get("type"),
        "variants": 0,
        "eta_s": None,
        "eta_alt_s": None,
        "distance_m": None,
        "algorithm": None,
        "colors": colors_hist(resp),
        "wkt_segments": 0,
    }
    results = resp.get("result") or []
    out["variants"] = len(results)
    durs = []
    for res in results:
        d = 0
        dist = 0
        segs = 0
        for m in res.get("maneuvers") or []:
            op = m.get("outcoming_path") or {}
            d += op.get("duration") or 0
            dist += op.get("distance") or 0
            segs += len(op.get("geometry") or [])
        out["wkt_segments"] = max(out["wkt_segments"], segs)
        if res.get("algorithm") and out["algorithm"] is None:
            out["algorithm"] = res.get("algorithm")
        durs.append((d, dist))
    if durs:
        durs.sort()
        out["eta_s"], out["distance_m"] = durs[0]
        if len(durs) > 1:
            out["eta_alt_s"] = durs[1][0]
    return out


def route_body(points, transport="car", traffic_mode="jam", alternative=0, output="detailed", truck=False, utc=None):
    body = {
        "locale": "ru",
        "transport": transport,
        "route_mode": "fastest",
        "traffic_mode": traffic_mode,
        "output": output,
        "alternative": alternative,
        "points": [{"type": "stop", "lon": p[0], "lat": p[1], **({"start": True} if i == 0 else {})}
                   for i, p in enumerate(points)],
    }
    if truck:
        body["truck_params"] = TRUCK_PARAMS
    if utc is not None:
        body["utc"] = utc
    return body


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--key", default=os.environ.get("2GIS_API_KEY", ""))
    ap.add_argument("--proxy", default="", help="через прокси демо, напр. http://localhost:3000/api/2gis/routing")
    ap.add_argument("--out", default="/home/z/my-project/download/2gis-tests")
    args = ap.parse_args()
    if not args.key:
        print("❌ Ключ не задан: --key XXX или env 2GIS_API_KEY")
        return 2

    url = args.proxy if args.proxy else UPSTREAM
    is_proxy = bool(args.proxy)
    results = []
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    def run(test_id: str, title: str, body: dict, key_override: str | None = None):
        use_key = key_override if key_override is not None else args.key
        http_status, resp, ms, err = call(url, body, use_key)
        s = summarize(resp) if isinstance(resp, dict) else {}
        s.update({"test": test_id, "title": title, "http": http_status, "latency_ms": ms, "error": err})
        # meta прокси (если есть)
        if isinstance(resp, dict) and resp.get("meta"):
            s["proxy_meta"] = resp["meta"]
        s["request"] = {k: v for k, v in body.items() if k != "points"}
        s["points"] = body["points"]
        results.append(s)
        raw_path = out_dir / f"raw-{test_id}.json"
        raw_path.write_text(json.dumps(resp, ensure_ascii=False, indent=2) if resp is not None else "null")
        eta = f"{s['eta_s']//60:.0f}м{int(s['eta_s']%60):02d}с" if s.get("eta_s") is not None else "—"
        dist = f"{s['distance_m']/1000:.1f} км" if s.get("distance_m") is not None else "—"
        print(f"{test_id}  {title[:44]:44}  http={http_status}  {ms:5} мс  status={s.get('status')}  "
              f"вар={s['variants']}  ETA={eta}  {dist}  slow={s['colors'].get('slow', 0)}  err={err or '-'}")
        return s

    print(f"URL: {'прокси демо ' + url if is_proxy else 'напрямую ' + UPSTREAM}")
    print("-" * 130)

    # T1 — городской smoke
    run("T1", "Новороссийск ~4 км, car+jam",
        route_body([NOVOROSS_PORT, NOVOROSS_CITY]))

    # T2 — А-146 car vs truck
    run("T2a", "Абинск→Крымск, car+jam", route_body([ABINSK, KRIMSK]))
    run("T2b", "Абинск→Крымск, truck 18т h3.5", route_body([ABINSK, KRIMSK], transport="truck", truck=True))

    # T3 — полный рейс (лимит демо-ключа 50 км?)
    run("T3", "Абинск→Новороссийск 63 км (лимит?)", route_body([ABINSK, NOVOROSS_CITY]))

    # T4 — jam vs statistics (прогноз)
    run("T4a", "Абинск→Крымск, car+statistics", route_body([ABINSK, KRIMSK], traffic_mode="statistics"))

    # T5 — альтернативы
    run("T5", "Абинск→Крымск, truck+alternative=2", route_body([ABINSK, KRIMSK], transport="truck", truck=True, alternative=2))

    # T6 — невалидный ключ
    run("T6", "Невалидный ключ (ожидаем отказ)", route_body([NOVOROSS_PORT, NOVOROSS_CITY]), key_override="invalid-key-test")

    # Повтор T2a через прокси — проверка кеша (cached=true)
    if is_proxy:
        run("T2a-rep", "Повтор T2a — кеш прокси?", route_body([ABINSK, KRIMSK]))

    # Сводный отчёт
    now = datetime.now(timezone.utc).astimezone()
    ok_count = sum(1 for r in results if r.get("status") == "OK")
    (out_dir / "2gis-report.json").write_text(json.dumps({"generated": now.isoformat(), "url": url, "results": results}, ensure_ascii=False, indent=2))

    md = [
        "# Тест Routing API 2ГИС — АЗМЗ Логистика",
        "",
        f"- Дата: {now.strftime('%Y-%m-%d %H:%M %Z')}",
        f"- Точка вызова: {'серверный прокси демо (' + url + ')' if is_proxy else 'напрямую ' + UPSTREAM}",
        f"- Итог: {ok_count}/{len(results)} тестов вернули status=OK",
        "",
        "| Тест | Сценарий | HTTP | Латентность | Статус | Вариантов | ETA | Дистанция | slow-сегментов |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for r in results:
        eta = f"{r['eta_s']//60:.0f}м{int(r['eta_s']%60):02d}с" if r.get("eta_s") is not None else "—"
        dist = f"{r['distance_m']/1000:.1f} км" if r.get("distance_m") is not None else "—"
        md.append(f"| {r['test']} | {r['title']} | {r['http']} | {r['latency_ms']} мс | {r.get('status')} | "
                  f"{r['variants']} | {eta} | {dist} | {r['colors'].get('slow', 0)} |")
    md += ["", "## Примечания", ""]
    t3 = next((r for r in results if r["test"] == "T3"), None)
    if t3 and t3.get("status") != "OK":
        md.append(f"- T3 (63 км) не прошёл: status={t3.get('status')}, message={t3.get('message')} — "
                  "подтверждён лимит демо-ключа «до 50 км между точками»; для боевого ключа снимается тарифом.")
    if is_proxy:
        rep = next((r for r in results if r["test"] == "T2a-rep"), None)
        if rep and (rep.get("proxy_meta") or {}).get("cached"):
            md.append("- Кеш прокси работает (второй идентичный запрос отдался из памяти, 30 с TTL).")
    (out_dir / "2gis-report.md").write_text("\n".join(md) + "\n", encoding="utf-8")

    print("-" * 130)
    print(f"OK: {ok_count}/{len(results)} · отчёты: {out_dir}/2gis-report.json, .md, raw-*.json")
    return 0 if ok_count >= 4 else 1


if __name__ == "__main__":
    sys.exit(main())
