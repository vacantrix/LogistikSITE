"""Только русские буквы в русских полях — проверка на реальных фото.

Нейросеть №3 не перезапускается: берём те же проценты по каждой букве, запрещаем латиницу и цифры
и заново выбираем букву. Оценку считаем как долю выбранной буквы среди разрешённых вариантов
(то же среднее по буквам, что и в PaddleOCR).
Проверяются строки, где есть кириллица и нет цифр — это ФИО, места, адреса.
Запуск: python -X utf8 alphabet_probe.py photo.jpg [photo2.jpg ...] → out/confidence/alphabet.json
"""
import json
import re
import sys
from pathlib import Path

import numpy as np

import confidence_probe as cp
from recognize import get_ocr

ROOT = Path(__file__).parent
RUSSIAN = re.compile(r"[А-Яа-яЁё \-.]")


def decode(probs, chars, allowed):
    mask = np.array([k == 0 or bool(allowed.fullmatch(c)) for k, c in enumerate(chars)])
    p = probs * mask
    p = p / p.sum(-1, keepdims=True)
    idx, mx = p.argmax(-1), p.max(-1)
    keep = np.ones(len(idx), bool)
    keep[1:] = idx[1:] != idx[:-1]
    keep &= idx != 0
    text = "".join(chars[i] for i in idx[keep])
    return text, float(mx[keep].mean()) if keep.any() else 0.0


def main(paths):
    report = []
    for path in map(Path, paths):
        cp.CAPTURED.clear()
        res = get_ocr().predict(str(path))[0]
        entries = []
        for probs, chars in cp.CAPTURED:
            for b in range(probs.shape[0]):
                text, score, _, _ = cp.analyse(probs[b], chars)
                entries.append((text, score, probs[b], chars))
        print(f"\n== {path.name}")
        for text, score in zip(res["rec_texts"], res["rec_scores"]):
            if not re.search(r"[А-Яа-яЁё]", text) or re.search(r"\d", text):
                continue
            hit = next((e for e in entries if e[0] == text and abs(e[1] - score) < 1e-3), None)
            if hit is None:
                continue
            new_text, new_score = decode(hit[2], hit[3], RUSSIAN)
            report.append({"image": path.name, "before": text, "before_score": round(float(score), 4),
                           "after": new_text, "after_score": round(new_score, 4)})
            print(f"  {score:.3f} {text!r:28} → {new_score:.3f} {new_text!r}")
    out = ROOT / "out" / "confidence" / "alphabet.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main(sys.argv[1:])
