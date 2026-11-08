import cv2, numpy as np
import engine
from pathlib import Path

files = ["Зубашев ВА ПС_page-0001.jpg", "Зубашев ВА ПС_page-0002.jpg", "1 стр пас.jpg", "2 стр пасп.jpg",
         "Мирвода п2.jpg", "1 стр тягача.jpg", "2 стр тягача.jpg", "1 стр прицеп.jpg", "2 стр прицеп.jpg"]
for f in files:
    p = Path("/home/z/my-project/upload") / f
    img = cv2.imdecode(np.fromfile(str(p), np.uint8), cv2.IMREAD_COLOR)
    box = engine.document_box(img)
    h, w = img.shape[:2]
    if box:
        x0, y0, x1, y1 = (int(v) for v in box)
        print(f"{f}: {w}x{h} -> box ({x0},{y0})-({x1},{y1}) {100*(x1-x0)*(y1-y0)/(w*h):.0f}%")
    else:
        print(f"{f}: {w}x{h} -> None (без вырезки)")
# виз: вырезка Зубашева
img = cv2.imdecode(np.fromfile("/home/z/my-project/upload/Зубашев ВА ПС_page-0001.jpg", np.uint8), cv2.IMREAD_COLOR)
x0, y0, x1, y1 = (int(v) for v in engine.document_box(img))
crop = img[y0:y1, x0:x1]
big = cv2.resize(crop, None, fx=min(3.0, 1500 / max(crop.shape[:2])), fy=min(3.0, 1500 / max(crop.shape[:2])), interpolation=cv2.INTER_CUBIC)
big = cv2.rotate(big, cv2.ROTATE_90_CLOCKWISE)
cv2.imencode(".png", cv2.resize(big, None, fx=0.5, fy=0.5))[1].tofile("/tmp/new_crop_preview.png")
print("preview saved", crop.shape, "->", big.shape)
