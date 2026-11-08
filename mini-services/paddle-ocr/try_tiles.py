import cv2, numpy as np
from pathlib import Path
import engine

p = Path("/home/z/my-project/upload/Зубашев ВА ПС_page-0001_crop_t0.png")
img = cv2.imdecode(np.fromfile(str(p), np.uint8), cv2.IMREAD_COLOR)
Y0, Y1 = 104, 560
tiles = []
for ty in ((Y0 - 30, Y0 + 330), (Y0 + 240, Y1)):
    for tx in ((0, 740), (580, 1321)):
        tx = (max(0, tx[0]), min(img.shape[1], tx[1]))
        ty = (max(0, ty[0]), min(img.shape[0], ty[1]))
        tiles.append((tx, ty))
for tx, ty in tiles:
    crop = img[ty[0]:ty[1], tx[0]:tx[1]]
    big = cv2.resize(crop, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
    ds = engine.det_side_for(*big.shape[:2])
    res = engine.helper_ocr().predict(big, use_textline_orientation=False,
           text_det_limit_side_len=ds, text_det_limit_type="max")[0]
    print(f"--- tile x{tx} y{ty} -> {big.shape[1]}x{big.shape[0]} det={ds}")
    for t, s, poly in zip(res["rec_texts"], res["rec_scores"], res["rec_polys"]):
        print(f"    conf={float(s):.2f} {engine.cyr(t)!r}")
