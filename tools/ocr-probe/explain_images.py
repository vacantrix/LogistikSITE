"""Картинки для объяснения, как PaddleOCR читает фото: вход → строки в рамках → выпрямленные строки → текст."""
import json
from pathlib import Path

import cv2
import numpy as np

from recognize import get_ocr

ROOT = Path(__file__).parent
OUT = ROOT / "out" / "explain"
SRC = ROOT / "samples" / "vu_ok.jpg"
CROP = (150, 140, 1490, 1020)          # область карточки на образце
PICK = ["ИВАНОВ", "ИВАНИВАНОВИЧ", "15.05.1990", "99 12"]   # строки для шагов 3–4


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    img = cv2.imdecode(np.fromfile(str(SRC), np.uint8), cv2.IMREAD_COLOR)
    res = get_ocr().predict(str(SRC))[0]
    x0, y0, x1, y1 = CROP
    cv2.imencode(".jpg", img[y0:y1, x0:x1])[1].tofile(str(OUT / "1_input.jpg"))

    boxed = img.copy()
    for poly in res["rec_polys"]:
        p = np.array(poly, np.int32)
        cv2.polylines(boxed, [p], True, (216, 78, 29), 4)
    cv2.imencode(".jpg", boxed[y0:y1, x0:x1])[1].tofile(str(OUT / "2_boxes.jpg"))

    strips, picked = [], []
    for want in PICK:
        i = next(i for i, t in enumerate(res["rec_texts"]) if t == want or (len(want) < len(t) and t.startswith(want) and want[-1].isdigit()))
        p = np.array(res["rec_polys"][i], np.float32)
        w = int(np.linalg.norm(p[1] - p[0])); h = int(np.linalg.norm(p[3] - p[0]))
        M = cv2.getPerspectiveTransform(p, np.float32([[0, 0], [w, 0], [w, h], [0, h]]))
        strip = cv2.warpPerspective(img, M, (w, h))
        strip = cv2.copyMakeBorder(strip, 6, 6, 10, 10, cv2.BORDER_CONSTANT, value=(255, 255, 255))
        strips.append(strip)
        picked.append({"text": res["rec_texts"][i], "conf": round(float(res["rec_scores"][i]), 3)})
    W = max(s.shape[1] for s in strips)
    canvas = np.full((sum(s.shape[0] for s in strips) + 24 * (len(strips) + 1), W + 40, 3), 255, np.uint8)
    y = 24
    for s in strips:
        canvas[y:y + s.shape[0], 20:20 + s.shape[1]] = s
        y += s.shape[0] + 24
    cv2.imencode(".png", canvas)[1].tofile(str(OUT / "3_lines.png"))

    (OUT / "4_text.json").write_text(json.dumps({"lines_total": len(res["rec_texts"]), "picked": picked}, ensure_ascii=False, indent=2), encoding="utf-8")
    print("строк найдено:", len(res["rec_texts"]), "| выбрано:", picked)


if __name__ == "__main__":
    main()
