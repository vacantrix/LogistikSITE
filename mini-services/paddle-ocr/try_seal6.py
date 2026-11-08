import cv2, numpy as np, re
from pathlib import Path
import engine

img = cv2.imdecode(np.fromfile("/home/z/my-project/upload/Зубашев ВА ПС_page-0001_crop_t0.png", np.uint8), cv2.IMREAD_COLOR)
zone = img[104:560, :]
crop = zone[44:444, 351:751]
for fx in (2.0, 2.5):
    big = cv2.resize(crop, None, fx=fx, fy=fx, interpolation=cv2.INTER_CUBIC)
    ds = engine.det_side_for(*big.shape[:2])
    res = engine.helper_ocr().predict(big, use_textline_orientation=False,
           text_det_limit_side_len=ds, text_det_limit_type="max")[0]
    print(f"--- seal fx={fx} -> {big.shape[1]}x{big.shape[0]} det={ds}")
    for t, s in zip(res["rec_texts"], res["rec_scores"]):
        print(f"    conf={float(s):.2f} {engine.cyr(t)!r}")
