#!/usr/bin/env python3
import base64, json, time, urllib.request, urllib.error
GW = "http://127.0.0.1:3020"
CASES = [("PASSPORT_PHOTO", "/home/z/my-project/upload/1 стр пас.jpg"), ("PASSPORT_REG", "/home/z/my-project/upload/2 стр пасп.jpg")]
def run(doc_type, path):
    with open(path, "rb") as f:
        data_uri = "data:image/jpeg;base64," + base64.b64encode(f.read()).decode()
    req = urllib.request.Request(GW + "/ocr", data=json.dumps({"type": doc_type, "dataUri": data_uri}).encode(), headers={"Content-Type": "application/json"})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            body = r.read().decode(); dt = time.time() - t0
            print(f"=== {doc_type}: HTTP {r.status} in {dt:.1f}s")
            try:
                j = json.loads(body)
                print(json.dumps(j, ensure_ascii=False, indent=1)[:2500])
            except Exception:
                print(body[:1500])
            return r.status == 200
    except urllib.error.HTTPError as e:
        print(f"=== {doc_type}: HTTP {e.code} in {time.time()-t0:.1f}s — {e.read().decode()[:500]}")
        return False
    except Exception as e:
        print(f"=== {doc_type}: FAILED in {time.time()-t0:.1f}s — {type(e).__name__}: {e}")
        return False
ok1 = run(*CASES[0]); ok2 = run(*CASES[1])
print("E2E_RESULT:", "BOTH_OK" if (ok1 and ok2) else f"photo={ok1} reg={ok2}")
