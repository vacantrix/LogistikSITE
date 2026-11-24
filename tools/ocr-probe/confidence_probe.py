"""Уверенность по буквам: перехватываем вероятности, которые нейросеть №3 выдаёт на каждом шаге строки.

Оценка строки в PaddleOCR = среднее из оценок букв (CTCLabelDecode.decode → np.mean(conf_list)).
Скрипт показывает, из каких букв складывается это среднее и какие варианты нейросеть ещё рассматривала.
Запуск: python -X utf8 confidence_probe.py photo.jpg [photo2.jpg ...] → out/confidence/<имя>.json
(+ вырезанные строки в out/confidence/<имя>/NN.png)
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from paddlex.inference.models.text_recognition import processors as P

from recognize import get_ocr

ROOT = Path(__file__).parent
OUT = ROOT / "out" / "confidence"
CAPTURED = []
_orig_call = P.CTCLabelDecode.__call__


def _spy(self, pred, return_word_box=False, **kw):
    CAPTURED.append((np.array(pred[0]), self.character))
    return _orig_call(self, pred, return_word_box=return_word_box, **kw)


P.CTCLabelDecode.__call__ = _spy


def name(chars, k):
    return "∅" if k == 0 else ("␣" if chars[k] == " " else chars[k])


def analyse(probs, chars):
    """Повторяем декодер PaddleOCR шаг за шагом и сохраняем то, что он отбрасывает."""
    idx, mx = probs.argmax(-1), probs.max(-1)
    keep = np.ones(len(idx), bool)
    keep[1:] = idx[1:] != idx[:-1]
    keep &= idx != 0
    space = chars.index(" ") if " " in chars else None
    letters = []
    for t in np.where(keep)[0]:
        top = np.argsort(-probs[t])[:4]
        letters.append({"step": int(t), "char": chars[idx[t]], "p": round(float(mx[t]), 4),
                        "alt": [[name(chars, k), round(float(probs[t][k]), 4)] for k in top if k != idx[t]][:3]})
    text = "".join(l["char"] for l in letters)
    # где нейросеть «думала» о пробеле, но выбрала пустой шаг
    gaps = []
    if space is not None:
        for t in range(len(idx)):
            if idx[t] == 0 and probs[t][space] > 0.05:
                gaps.append({"step": t, "p_space": round(float(probs[t][space]), 4), "p_blank": round(float(probs[t][0]), 4)})
    score = float(np.mean([l["p"] for l in letters])) if letters else 0.0
    return text, score, letters, gaps


def main(paths):
    OUT.mkdir(parents=True, exist_ok=True)
    for path in map(Path, paths):
        CAPTURED.clear()
        res = get_ocr().predict(str(path))[0]
        img = cv2.imdecode(np.fromfile(str(path), np.uint8), cv2.IMREAD_COLOR)
        (OUT / path.stem).mkdir(exist_ok=True)
        decoded = []
        for probs, chars in CAPTURED:
            for b in range(probs.shape[0]):
                decoded.append(analyse(probs[b], chars))
        lines = []
        for n, (text, score, poly) in enumerate(zip(res["rec_texts"], res["rec_scores"], res["rec_polys"])):
            strip = f"{path.stem}/{n:02d}.png"
            q = np.array(poly, np.float32)
            w, h = int(np.linalg.norm(q[1] - q[0])), int(np.linalg.norm(q[3] - q[0]))
            M = cv2.getPerspectiveTransform(q, np.float32([[0, 0], [w, 0], [w, h], [0, h]]))
            cv2.imencode(".png", cv2.warpPerspective(img, M, (w, h)))[1].tofile(str(OUT / strip))
            hit = next((d for d in decoded if d[0] == text and abs(d[1] - score) < 1e-3), None)
            if hit is None:
                lines.append({"text": text, "score": round(float(score), 4), "strip": strip, "letters": None})
                continue
            _, s, letters, gaps = hit
            lines.append({"text": text, "score": round(float(score), 4), "mean_check": round(s, 4), "strip": strip, "letters": letters, "space_doubts": gaps})
        (OUT / (path.stem + ".json")).write_text(json.dumps({"image": path.name, "lines": lines}, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"\n== {path.name}: строк {len(lines)}")
        for l in lines:
            if not l["letters"]:
                print(f"  {l['text']!r}: не сопоставлено")
                continue
            weak = sorted(l["letters"], key=lambda x: x["p"])[:3]
            weak_s = ", ".join(f"{w['char']}={w['p']:.2f} (ещё {w['alt'][0][0]} {w['alt'][0][1]:.2f})" for w in weak)
            sp = f" | пробел-сомнения: {max(g['p_space'] for g in l['space_doubts']):.2f}" if l["space_doubts"] else ""
            print(f"  {l['score']:.3f} (ср. {l['mean_check']:.3f}) {l['text']!r} → слабые: {weak_s}{sp}")


if __name__ == "__main__":
    main(sys.argv[1:] or [str(ROOT / "samples" / "vu_ok.jpg")])
