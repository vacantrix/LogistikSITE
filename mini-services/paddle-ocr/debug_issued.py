"""Одноразовая отладка: «Кем выдан» на выцветшем развороте (Зубашев ВА ПС_page-0001.jpg)"""
import sys
from pathlib import Path
import engine

# --- микро-тесты issuer_rows (без OCR) ---
mk = lambda t, cy, h=20.0, x0=0.0, conf=0.9: {"text": t, "conf": conf, "x0": x0, "x1": x0 + 100, "y0": cy - h / 2,
                                              "y1": cy + h / 2, "cx": x0 + 50, "cy": cy, "w": 100.0, "h": h}
t1 = [mk("РОССИЙСКАЯ ФЕДЕРАЦИЯ", 30), mk("ГУ МВД РОССИИ ПО", 90), mk("РОСТОВСКОЙ ОБЛАСТИ", 150)]
t2 = [mk("РОССИЙСКАЯ", 30), mk("ФЕДЕРАЦИЯ", 90), mk("ГУ МВД РОССИИ ПО РОСТОВСКОЙ ОБЛАСТИ", 150)]
t3 = [mk("60 19", 30), mk("ГУ МВД РОССИИ ПО РОСТОВСКОЙ ОБЛАСТИ", 90)]
print("T1:", [l["text"] for l in engine.issuer_rows(t1)])
print("T2:", [l["text"] for l in engine.issuer_rows(t2)])
print("T3:", [l["text"] for l in engine.issuer_rows(t3)])

orig = engine.issued_by
def dbg_issued(path, lines, f):
    r = orig(path, lines, f)
    print(f"=== issued_by: value={r.get('value')!r} conf={r.get('conf')}", flush=True)
    return r
engine.issued_by = dbg_issued

out = engine.analyze(Path(sys.argv[1] if len(sys.argv) > 1 else "/home/z/my-project/upload/Зубашев ВА ПС_page-0001.jpg"))
print("\n===== FINAL docType:", out["docType"])
for k, v in out["fields"].items():
    print(f"  {k}: {v!r} (conf {out['confidences'].get(k)})")
