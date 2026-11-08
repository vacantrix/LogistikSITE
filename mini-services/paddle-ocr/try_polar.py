import cv2, numpy as np, re
from pathlib import Path
import engine

img = cv2.imdecode(np.fromfile("/home/z/my-project/upload/Зубашев ВА ПС_page-0001_crop_t0.png", np.uint8), cv2.IMREAD_COLOR)
zone = img[104:560, :]
CX, CY, ROUT = 551, 244, 185
for name, src in (("as-is", zone), ("flipX", cv2.flip(zone, 1))):
    strip = cv2.warpPolar(src, (2400, 300), (CX, CY), ROUT, cv2.WARP_POLAR_LINEAR | cv2.INTER_LINEAR)
    band = strip[165:295, :]
    if name == "flipX":
        band = cv2.flip(band, 1)
    ds = engine.det_side_for(*band.shape[:2])
    res = engine.helper_ocr().predict(band, use_textline_orientation=False,
           text_det_limit_side_len=ds, text_det_limit_type="max")[0]
    print(f"--- {name} band {band.shape[1]}x{band.shape[0]} det={ds}")
    for t, s, poly in zip(res["rec_texts"], res["rec_scores"], res["rec_polys"]):
        poly = np.array(poly)
        ang = poly[:, 0].min() / band.shape[1] * 360
        print(f"    conf={float(s):.2f} ang={ang:6.1f} {engine.cyr(t)!r}")
