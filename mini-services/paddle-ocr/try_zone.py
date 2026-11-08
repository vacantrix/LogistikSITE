import cv2, numpy as np, re
from pathlib import Path
import engine

p = Path("/home/z/my-project/upload/Зубашев ВА ПС_page-0001_crop_t0.png")
for y0, y1, fx in ((104, 560, 2.0), (104, 560, 1.0)):
    img = cv2.imdecode(np.fromfile(str(p), np.uint8), cv2.IMREAD_COLOR)
    crop = img[y0:y1, :]
    big = cv2.resize(crop, None, fx=fx, fy=fx, interpolation=cv2.INTER_CUBIC)
    res = engine.helper_ocr().predict(big, use_textline_orientation=False,
           text_det_limit_side_len=engine.det_side_for(*big.shape[:2]), text_det_limit_type="max")[0]
    print(f"--- zone y{y0}..{y1} fx={fx} -> {big.shape[1]}x{big.shape[0]} det_side={engine.det_side_for(*big.shape[:2])}")
    for t, s, poly in zip(res["rec_texts"], res["rec_scores"], res["rec_polys"]):
        poly = np.array(poly)
        print(f"    conf={float(s):.2f} x={poly[:,0].min():5.0f} y={poly[:,1].min():5.0f} {engine.cyr(t)!r}")
