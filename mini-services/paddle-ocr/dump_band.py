import cv2, numpy as np
from pathlib import Path
import engine
p = Path("/home/z/my-project/upload/Зубашев ВА ПС_page-0001.jpg")
work, cropped = engine.prepare(p)
print("prepared:", work, cropped)
lines, work, turns = engine.read_upright(work, p)
print("turns:", turns, "work:", work)
f, copies = engine.extract_passport(work, lines)
anchor = min([x["line"] for x in (f["issue_date"], f["dept"]) if x.get("line")], key=lambda l: l["cy"])
b = engine.img_box(anchor)
img = cv2.imdecode(np.fromfile(str(work), np.uint8), cv2.IMREAD_COLOR)
y0, y1 = 0, int(b["y0"] - 0.1 * b["h"])
print("img:", img.shape, "anchor box:", b, "band:", y0, y1)
crop = img[y0:y1, :]
big = cv2.resize(crop, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
cv2.imencode(".png", big)[1].tofile("/tmp/band_x3.png")
cv2.imencode(".png", crop)[1].tofile("/tmp/band_native.png")
# и вся страница для ориентира
cv2.imencode(".png", cv2.resize(img, None, fx=0.5, fy=0.5))[1].tofile("/tmp/page_half.png")
