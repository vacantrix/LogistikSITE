"""Регрессия: старый паспорт (рукописный «Кем выдан») и страница регистрации"""
import sys
from pathlib import Path
import engine

orig = engine.issued_by
def dbg_issued(path, lines, f):
    r = orig(path, lines, f)
    print(f"=== issued_by: value={r.get('value')!r} conf={r.get('conf')}", flush=True)
    return r
engine.issued_by = dbg_issued

for name in ("1 стр пас.jpg", "Зубашев ВА ПС_page-0002.jpg", "2 стр пасп.jpg"):
    print(f"\n########## {name}", flush=True)
    out = engine.analyze(Path("/home/z/my-project/upload") / name)
    print("===== docType:", out["docType"], flush=True)
    for k, v in out["fields"].items():
        if v:
            print(f"  {k}: {v!r} (conf {out['confidences'].get(k)})", flush=True)
