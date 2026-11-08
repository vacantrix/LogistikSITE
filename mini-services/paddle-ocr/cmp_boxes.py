import cv2, numpy as np, importlib.util, sys

# старый document_box из git
spec = importlib.util.spec_from_file_location("eng_old", "/tmp/engine_old.py")
old_src = open("/tmp/engine_old.py").read() if False else None
import subprocess
head = subprocess.check_output(["git", "-C", "/home/z/my-project", "show", "HEAD:mini-services/paddle-ocr/engine.py"]).decode()
ns = {}
# исполняем только нужные функции: вырезаем импорты и def document_box
import re, types
lines = head.split("\n")
keep, grab = [], False
for l in lines:
    if l.startswith("def document_box"):
        grab = True
    elif grab and l and not l[0].isspace() and not l.startswith("def document_box"):
        break
    if grab:
        keep.append(l)
mod = types.ModuleType("eng_part")
exec("\n".join(keep) + "\nimport cv2\nimport numpy as np", mod.__dict__)
old_box = mod.document_box

import engine as new_engine
from pathlib import Path
for f in ("Зубашев ВА ПС_page-0001.jpg", "Зубашев ВА ПС_page-0002.jpg", "1 стр пас.jpg", "2 стр пасп.jpg",
          "Мирвода п2.jpg", "1 стр тягача.jpg", "2 стр тягача.jpg", "1 стр прицеп.jpg", "2 стр прицеп.jpg"):
    img = cv2.imdecode(np.fromfile(str(Path("/home/z/my-project/upload") / f), np.uint8), cv2.IMREAD_COLOR)
    bo, bn = old_box(img), new_engine.document_box(img)
    fmt = lambda b: "None" if b is None else "(%d,%d)-(%d,%d)" % tuple(int(v) for v in b)
    print(f"{f}:\n  old: {fmt(bo)}\n  new: {fmt(bn)}")
