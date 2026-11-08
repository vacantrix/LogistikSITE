from pathlib import Path
import engine
for name in ("Зубашев ВА ПС_page-0002.jpg", "2 стр пасп.jpg", "1 стр пас.jpg"):
    print(f"\n########## {name}", flush=True)
    out = engine.analyze(Path("/home/z/my-project/upload") / name)
    print("===== docType:", out["docType"], flush=True)
    for k, v in out["fields"].items():
        if v:
            print(f"  {k}: {v!r} (conf {out['confidences'].get(k)})", flush=True)
