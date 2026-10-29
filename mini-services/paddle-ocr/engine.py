"""Чтение документов перевозчика: PaddleOCR + шаблоны полей.

PaddleOCR (три нейросети: поиск строк, ориентация строк, чтение) только читает текст.
Дальше обычный код: тип документа по ключевым словам, поля по шаблону и независимые
подтверждения, которые видны на самом документе (копии номера на полях паспорта,
латинская строка ВУ, повторное чтение категорий, срок ВУ = выдача + 10 лет).
Свободный текст (место рождения, «Кем выдан», адрес, имя, отчество) сверяется со словарём
(lexicon.py, см. lex_fix); наклонённое, снятое боком или вверх ногами фото выпрямляется.

Правила проверки (сверка с заявкой, пороги, статусы) — на платформе (src/lib/verify.ts):
сервис получает только фото и ничего не знает о заявке.

Поддерживаются: паспорт РФ (страница с фото; серия и номер — с полей страницы),
страница регистрации, водительское удостоверение, СТС (лицевая сторона и оборот),
доверенность по форме М-2.

Одна сильная модель (Task 86, боевой тест): детекция — PP-OCRv5_server_det, чтение —
eslav_PP-OCRv5_mobile_rec. Лёгкая модель детекции (mobile_det) убрана: это была вторая
сеть «на добор», а сильнее server_det в PaddleOCR для кириллицы нет (у server_rec и
PP-OCRv6_rec словари без кириллицы — проверено по inference.yml). Недочитанные места
добирает не вторая модель, а повторные проходы по кадру: целый лист, штамп прописки
крупным планом (stamp_pass), кадр ×1,5 и разворот на 180°.
"""
import os
import math
import re
from datetime import date

import cv2
import numpy as np

SHARPNESS_MIN = 60.0   # дисперсия лапласиана: ниже — фото размыто (соответствует качеству 60 из 100)

LAT2CYR = str.maketrans("ABEKMHOPCTYX", "АВЕКМНОРСТУХ")   # латинские буквы, похожие на кириллицу
CYR2LAT = str.maketrans("АВЕКМНОРСТУХ", "ABEKMHOPCTYX")
CAT_ORDER = ["A", "A1", "B", "B1", "BE", "C", "C1", "CE", "C1E", "D", "D1", "DE", "D1E", "M", "TM", "TB"]
CATEGORIES = set(CAT_ORDER)
DATE_RE = re.compile(r"(\d{2})[.,](\d{2})[.,](\d{4})")
TRANSLIT = {"А": "A", "Б": "B", "В": "V", "Г": "G", "Д": "D", "Е": "E", "Ё": "E", "Ж": "ZH", "З": "Z", "И": "I",
            "Й": "I", "К": "K", "Л": "L", "М": "M", "Н": "N", "О": "O", "П": "P", "Р": "R", "С": "S", "Т": "T",
            "У": "U", "Ф": "F", "Х": "KH", "Ц": "TS", "Ч": "CH", "Ш": "SH", "Щ": "SHCH", "Ъ": "IE", "Ы": "Y",
            "Ь": "", "Э": "E", "Ю": "IU", "Я": "IA"}
SERIES_NUMBER_RE = re.compile(r"(\d{2})\s*(\d{2})\s+(\d{6})")   # двойной пробел скана — не помеха

# вид документа по шаблону → тип документа платформы
PLATFORM_TYPE = {"passport": "PASSPORT_PHOTO", "passport_registration": "PASSPORT_REG",
                 "driver_license": "LICENSE", "vehicle_registration": "STS", "vehicle_registration_back": "STS",
                 "poa": "POA", "unknown": "UNKNOWN"}
SUPPORTED = {"PASSPORT_PHOTO", "PASSPORT_REG", "LICENSE", "STS", "POA"}

# модели (Task 86 — одна сильная цепочка, переопределяются переменными окружения):
# детекция — PP-OCRv5_server_det (сильнейшая из кириллических в PaddleOCR), чтение —
# eslav_PP-OCRv5_mobile_rec (у server_rec/PP-OCRv6_rec словари без кириллицы — проверено)
DET_MODEL = os.environ.get("OCR_DET_MODEL", "PP-OCRv5_server_det")
REC_MODEL = os.environ.get("OCR_REC_MODEL", "eslav_PP-OCRv5_mobile_rec")
UPSCALE_BELOW = int(os.environ.get("OCR_UPSCALE_BELOW", "1300"))   # мелкие сканы увеличиваем вдвое
# детекция ищет строки на кадре не больше этого размера: на фото паспорта 1500×2000 — 38 с вместо 70,
# поля те же (сами строки читаются с исходного кадра). Лестницу при нехватке памяти задаёт
# _run_isolated этой же переменной у ребёнка
DET_MAX_SIDE = int(os.environ.get("OCR_DET_MAX_SIDE", "1600"))
# повторный проход по штампу прописки: вырезка штампа увеличивается до этого размера (см. stamp_pass)
STAMP_TARGET = int(os.environ.get("OCR_STAMP_TARGET", "1500"))


def available_mb():
    """Свободная оперативная память, МБ: Linux — /proc/meminfo, Windows — GlobalMemoryStatusEx."""
    try:
        with open("/proc/meminfo") as fh:
            info = {l.split(":")[0]: int(l.split()[1]) for l in fh if ":" in l}
        return info.get("MemAvailable", 0) // 1024
    except OSError:
        pass
    try:
        import ctypes

        class MemStatus(ctypes.Structure):
            _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                        ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                        ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                        ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                        ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]
        st = MemStatus()
        st.dwLength = ctypes.sizeof(MemStatus)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(st)):
            return st.ullAvailPhys // (1024 * 1024)
    except Exception:  # noqa: BLE001 — не Windows и нет /proc: считаем памяти впритык
        pass
    return 4096


# Режим экономии памяти (Task 83, стенд 4 ГБ): документ — в отдельном процессе.
# При запасе памяти (≥6 ГБ свободных) модель живёт прямо в процессе сервиса.
# OCR_LOW_MEMORY=1/0 — включить или выключить явно; иначе по свободной памяти при старте.
_low = os.environ.get("OCR_LOW_MEMORY", "").strip()
LOW_MEMORY = _low == "1" if _low in ("0", "1") else available_mb() < 6000

# Память стенда (Task 86): пиковая память детекции ≈ 4–5 ГБ на МПиксель входа, а пул paddle
# растёт кумулятивно от прохода к проходу. Ограничиваем площадь входа детекции у ВСЕХ проходов
# (целая страница, вырезка, штамп, полоса на полях) — не только сторону: у полос и вырезок
# свои пропорции, лимит по стороне их не спасал.
DET_AREA = float(os.environ.get("OCR_DET_AREA", "0.18"))   # МПиксель входа детекции


def det_side_for(h, w):
    """Лимит стороны кадра для детекции: вход ≤ DET_AREA МПиксель и ≤ DET_MAX_SIDE по стороне.
    Мелкие кадры не увеличиваются (лимит = их большая сторона) — только крупные уменьшаются."""
    scale = min(DET_MAX_SIDE / max(h, w), math.sqrt(DET_AREA * 1e6 / (h * w)), 1.0)
    return max(64, int(max(h, w) * scale))


def cyr(s):
    return s.upper().translate(LAT2CYR) if s else s


def norm_letters(s):
    """Для сверки ФИО: кириллица, верхний регистр, е вместо ё, только буквы."""
    return re.sub(r"[^А-Я]", "", cyr(s).replace("Ё", "Е"))


def translit(s):
    return "".join(TRANSLIT.get(ch, ch) for ch in norm_letters(s))


def norm_latin(s):
    s = re.sub(r"[^A-Z]", "", s.upper().translate(CYR2LAT))
    return s.replace("YU", "IU").replace("YA", "IA")


def norm_plate(s):
    return re.sub(r"\s", "", s.upper()).translate(LAT2CYR)


def norm_vin(s):
    return re.sub(r"\s", "", s.upper()).translate(CYR2LAT)


def parse_date(s):
    m = DATE_RE.search(s or "")
    if not m:
        return None
    try:
        return date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
    except ValueError:
        return None


def add_years(d, n):
    try:
        return d.replace(year=d.year + n)
    except ValueError:   # 29 февраля
        return d.replace(year=d.year + n, day=28)


# ---------------- чтение текста ----------------

_ocr = {}

# признаки известных документов: если на фото нет ни одного, повторный проход не нужен —
# это другая страница (военный учёт, семейное положение, оборот ВУ), её отправят на перезагрузку
DOC_HINTS = ("ПАСПОРТ", "ФАМИЛИЯ", "ОТЧЕСТВО", "РОЖДЕНИЯ", "ПОДРАЗДЕЛЕНИЯ", "ВОДИТЕЛЬСК", "УДОСТОВЕРЕН",
                                   "СВИДЕТЕЛЬСТВО", "СОБСТВЕННИК", "ДОВЕРЕННОСТ", "ЗАРЕГИСТРИР", "МЕСТОЖИТЕЛЬ")

# «Только русские буквы»: нейросеть чтения на каждом шаге строки выдаёт проценты по всем символам —
# и русским, и латинским. Для полей ФИО заново выбираем буквы только среди русских, перенося голоса
# латинских двойников («POMAH» → «РОМАН»). Нейросеть та же, перезапуска нет.
# Проценты перехватываются во внутренней части PaddleX — после обновления версии проверить
# (закреплены paddleocr 3.7.0 / paddlex 3.7.2 / paddlepaddle 3.3.1).
RUSSIAN_ONLY = True
RUSSIAN = re.compile(r"[А-Яа-яЁё \-]")
_PROBS = []


def _hook_decoder():
    from paddlex.inference.models.text_recognition import processors as P
    if getattr(P.CTCLabelDecode, "_aemz_hook", False):
        return
    orig = P.CTCLabelDecode.__call__

    def spy(self, pred, return_word_box=False, **kw):
        _PROBS.append((np.array(pred[0]), self.character))
        return orig(self, pred, return_word_box=return_word_box, **kw)

    P.CTCLabelDecode.__call__ = spy
    P.CTCLabelDecode._aemz_hook = True


TWINS = list(zip("ABEKMHOPCTYXaeopcxy306", "АВЕКМНОРСТУХаеорсхуЗОБ"))   # латинская буква или цифра → русская того же вида
DIGIT_TWINS = str.maketrans("306", "ЗОБ")


def greedy(probs, chars, allowed=None):
    """Тот же выбор букв, что в PaddleOCR (CTC: лучший символ на шаге, повторы и пустые шаги убираются);
    allowed — какие символы разрешены. Оценка строки — среднее по выбранным буквам."""
    if allowed is not None:
        probs = probs.copy()
        pos = {c: k for k, c in enumerate(chars)}
        for lat, rus in TWINS:
            if lat in pos and rus in pos:
                probs[:, pos[rus]] += probs[:, pos[lat]]
        probs = probs * np.array([k == 0 or bool(allowed.fullmatch(c)) for k, c in enumerate(chars)])
        probs = probs / probs.sum(-1, keepdims=True)
    idx, mx = probs.argmax(-1), probs.max(-1)
    keep = np.ones(len(idx), bool)
    keep[1:] = idx[1:] != idx[:-1]
    keep &= idx != 0
    return "".join(chars[i] for i in idx[keep]), (float(mx[keep].mean()) if keep.any() else 0.0)


# ---------------- словарная правка: «ВАРНАУЛ» → «БАРНАУЛ», «ФОРОДА» → «ГОРОДА» ----------------
# Слово не из словаря меняется на близкое словарное (1–2 буквы), только если нейросеть сама допускала
# такое чтение: правдоподобие строки с новым словом по выходу CTC хуже исходного не больше чем на
# LEX_TAU (натуральный логарифм). Уверенно прочитанное редкое слово (фамилия, улица не из списка)
# остаётся как есть: замена букв, в которых нейросеть уверена, стоит десятки единиц.
LEX_TAU = float(os.environ.get("OCR_LEX_TAU", "4.5"))   # ошибки чтения: 0…3,8; верные редкие слова: от 5,7
LEX_WORD_RE = re.compile(r"[А-ЯЁ]+(?:-[А-ЯЁ]+)*")
# сокращения, слипающиеся с соседним словом: «ТУАПСЕУЛ» → «ТУАПСЕ УЛ», «ГТУАПСЕ» → «Г ТУАПСЕ»
LEX_SHORT = ("Г", "С", "П", "Д", "Х", "УЛ", "КВ", "ПР", "РН")
_lex_index = {}
_lex_by_len = {}


def ctc_logp(lp, pos, text):
    """log P(text | выход CTC): сумма по всем выравниваниям (прямой проход), пустой символ — индекс 0.
    lp — логарифмы вероятностей [шаги × символы], pos — индекс символа. None — символа нет в модели."""
    if not text:
        return float(lp[:, 0].sum())
    try:
        ext = [0]
        for c in text:
            ext += [pos[c], 0]
    except KeyError:
        return None
    ext = np.array(ext)
    S = len(ext)
    skip = np.zeros(S, bool)
    skip[2:] = (ext[2:] != 0) & (ext[2:] != ext[:-2])
    a = np.full(S, -np.inf)
    a[0] = lp[0, ext[0]]
    a[1] = lp[0, ext[1]] if S > 1 else -np.inf
    for t in range(1, lp.shape[0]):
        a1 = np.concatenate(([-np.inf], a[:-1]))
        a2 = np.where(skip, np.concatenate(([-np.inf, -np.inf], a[:-2])), -np.inf)
        a = np.logaddexp(np.logaddexp(a, a1), a2) + lp[t, ext]
    return float(np.logaddexp(a[-1], a[-2]) if S > 1 else a[-1])


def _lev(a, b):
    d = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(b) + 1):
            prev, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] != b[j - 1]))
    return d[len(b)]


def _deletes(w):
    return {w[:i] + w[i + 1:] for i in range(len(w))}


def lex_words(kind):
    from lexicon import LEXICON
    return LEXICON[kind]


def lex_near(word, kind, maxd):
    """Словарные слова не дальше maxd правок (индекс удалений: замена, вставка, пропуск буквы)."""
    idx = _lex_index.get(kind)
    if idx is None:
        idx = {}
        for w in lex_words(kind):
            for k in {w} | _deletes(w):
                idx.setdefault(k, set()).add(w)
        _lex_index[kind] = idx
    found = set()
    for k in {word} | _deletes(word):
        found |= idx.get(k, set())
    near = [w for w in found if w != word and _lev(w, word) <= maxd]
    if maxd >= 2 and len(word) >= 6:
        # две замены букв («МАЯКОЕСКОТО» → «МАЯКОВСКОГО»): индекс удалений их не находит — сверяем
        # со словами той же длины
        if kind not in _lex_by_len:
            _lex_by_len[kind] = {}
            for w in lex_words(kind):
                _lex_by_len[kind].setdefault(len(w), []).append(w)
        near += [w for w in _lex_by_len[kind].get(len(word), ())
                 if w not in found and sum(a != b for a, b in zip(w, word)) <= 2]
    return near


def _part_cands(part, kind, words):
    """Варианты части слипшегося слова: короткая — сокращение (одна буква — без ошибок, две — одна замена)."""
    if len(part) <= 2:
        return [a for a in LEX_SHORT if len(a) == len(part) and sum(x != y for x, y in zip(a, part)) <= len(part) - 1]
    return [part] if part in words else lex_near(part, kind, 1)


def _lex_probs(line):
    """Выход CTC строки с голосами латинских и цифровых двойников, отданными русским буквам."""
    probs, chars = line["probs"]
    pos = {c: k for k, c in enumerate(chars)}
    p = probs.copy()
    for lat, rus in TWINS:
        if lat in pos and rus in pos:
            p[:, pos[rus]] += probs[:, pos[lat]]
    return np.log(np.clip(p, 1e-12, None)), pos


def lex_fix(text, line, kind):
    """Правка слов строки по словарю kind (place, issuer, address, name, patronymic).
    text — прочитанное с этой строки (тот же выход CTC); без выхода CTC строка не меняется."""
    if not text or not line or not line.get("probs"):
        return text
    words = lex_words(kind)
    lp, pos = _lex_probs(line)
    base = re.sub(r"(?<=[А-Я])[306]|[306](?=[А-Я]{2})", lambda m: m.group(0).translate(DIGIT_TWINS),
                  cyr(text).replace("Ё", "Е"))
    base_score = ctc_logp(lp, pos, base)
    if base_score is None:
        return text
    out = base
    for m in reversed(list(LEX_WORD_RE.finditer(base))):
        w = m.group(0)
        if w in words or len(w) < 4:
            continue
        cands = lex_near(w, kind, 1 if len(w) <= 5 else 2)
        if len(w) <= 5:
            cands = [c for c in cands if len(c) == len(w)]   # короткое слово: только замена буквы
        if len(w) >= 6:
            # два слова, слипшиеся в одно: «ФОРОДАВАРНАУЛА» → «ГОРОДА БАРНАУЛА», «ТУАПСЕУЙ» → «ТУАПСЕ УЛ»
            for i in range(1, len(w)):
                left, right = w[:i], w[i:]
                if min(len(left), len(right)) < 3 and kind not in ("address", "place"):
                    continue
                ls = _part_cands(left, kind, words)
                rs = _part_cands(right, kind, words) if ls else []
                cands += [f"{a} {b}" for a in ls[:5] for b in rs[:5]]
        best, best_score = None, -np.inf
        for c in cands:
            variants = (c, c.replace(" ", "")) if " " in c else (c,)
            for v in variants:
                s = ctc_logp(lp, pos, out[:m.start()] + v + out[m.end():])
                if s is not None and s > best_score:
                    best, best_score = c, s
        cur = ctc_logp(lp, pos, out)
        if best and cur is not None and best_score > cur - LEX_TAU:
            out = out[:m.start()] + best + out[m.end():]
    return out


def get_ocr():
    """Единственная сильная цепочка (Task 86): детекция server_det + чтение eslav_rec.

    Экономия памяти на стенде 4 ГБ (Task 83): модель — только одна, поэтому в памяти она
    всегда одна; при LOW_MEMORY документ обслуживает короткоживущий процесс (см.
    analyze_subprocess), и модель загружается в нём с нуля."""
    if "main" not in _ocr:
        from paddleocr import PaddleOCR
        if RUSSIAN_ONLY:
            _hook_decoder()
        # enable_mkldnn=False: в PaddlePaddle 3.3 ускоритель oneDNN падает на этих моделях
        _ocr["main"] = PaddleOCR(
            text_detection_model_name=DET_MODEL,
            text_recognition_model_name=REC_MODEL,
            use_doc_orientation_classify=False, use_doc_unwarping=False,
            use_textline_orientation=True, enable_mkldnn=False)
    return _ocr["main"]


def read_lines(path):
    ocr = get_ocr()
    _PROBS.clear()
    # лимит детекции — по площади входа (память стенда, см. det_side_for)
    img = cv2.imdecode(np.fromfile(str(path), np.uint8), cv2.IMREAD_COLOR)
    side = det_side_for(*img.shape[:2]) if img is not None else DET_MAX_SIDE
    res = ocr.predict(str(path), text_det_limit_side_len=side, text_det_limit_type="max")[0]
    decoded = [(*greedy(p[b], chars), p[b], chars) for p, chars in _PROBS for b in range(p.shape[0])]
    angles = list(res.get("textline_orientation_angles") or [])
    if len(angles) != len(res["rec_texts"]):
        angles = [None] * len(res["rec_texts"])
    lines = []
    for text, score, poly, angle in zip(res["rec_texts"], res["rec_scores"], res["rec_polys"], angles):
        p = np.array(poly, dtype=float)
        x0, y0 = p.min(axis=0)
        x1, y1 = p.max(axis=0)
        hit = next((d for d in decoded if d[0] == text and abs(d[1] - score) < 1e-3), None)
        lines.append({"text": text, "conf": float(score), "x0": x0, "y0": y0, "x1": x1, "y1": y1,
                      "cx": (x0 + x1) / 2, "cy": (y0 + y1) / 2, "w": x1 - x0, "h": y1 - y0,
                      "probs": (hit[2], hit[3]) if hit else None, "poly": p, "img_box": (x0, y0, x1, y1),
                      "angle": None if angle is None else int(angle)})
    deskew_lines(lines)
    lines.sort(key=lambda l: (l["cy"], l["x0"]))
    return lines


def page_turn(lines):
    """Как повернуть кадр, чтобы страница стояла прямо (код cv2.rotate), или None.
    Фото боком: строки вертикальные — сторону поворота голосуют строки по классификатору ориентации
    (PaddleOCR поворачивает высокую вырезку против часовой: «0» — кадр повёрнут по часовой).
    Вверх ногами: большинство горизонтальных строк классификатор переворачивает на 180°."""
    long = [l for l in lines if len(l["text"].strip()) >= 4 and l.get("angle") is not None]
    if len(long) < 4:
        return None
    wt = lambda l: len(l["text"].strip()) * max(l["conf"], 0.1)
    vert = [l for l in long if l["h"] > 2 * l["w"]]
    hor = [l for l in long if l["w"] > 2 * l["h"]]
    sv, sh = sum(map(wt, vert)), sum(map(wt, hor))
    if sv > 1.5 * sh:
        up = sum(wt(l) for l in vert if l["angle"] == 0)
        return cv2.ROTATE_90_COUNTERCLOCKWISE if up >= sv / 2 else cv2.ROTATE_90_CLOCKWISE
    if sh > 0 and sum(wt(l) for l in hor if l["angle"] == 1) > 0.65 * sh:
        return cv2.ROTATE_180
    return None


def read_upright(work, source):
    """Первое чтение кадра; снятую боком или вверх ногами страницу поворачиваем и читаем ещё раз.
    Возвращает (строки, кадр, повороты): повёрнутый кадр — новый временный файл (исходный work,
    если он временный, удаляется); повороты нужны, чтобы так же повернуть кадр целиком."""
    lines = read_lines(work)
    turns = []
    for _ in range(2):   # боком → прямо, и если угадали сторону неверно — ещё на 180°
        turn = page_turn(lines)
        if turn is None:
            break
        img = cv2.imdecode(np.fromfile(str(work), np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            break
        turned = work.with_name(work.stem + f"_t{len(turns)}.png")
        cv2.imencode(".png", cv2.rotate(img, turn))[1].tofile(str(turned))
        if work != source:
            try:
                os.unlink(work)
            except OSError:
                pass
        work = turned
        turns.append(turn)
        lines = read_lines(work)
        if turn == cv2.ROTATE_180:
            break
    return lines, work, turns


def turned_copy(path, turns, suffix):
    """Копия кадра с теми же поворотами, что у основного (read_upright), или сам path."""
    if not turns:
        return path
    img = cv2.imdecode(np.fromfile(str(path), np.uint8), cv2.IMREAD_COLOR)
    for t in turns:
        img = cv2.rotate(img, t)
    out = path.with_name(path.stem + suffix + ".png")
    cv2.imencode(".png", img)[1].tofile(str(out))
    return out


def deskew_lines(lines):
    """Наклонённое фото (телефон в руке): координаты строк поворачиваются так, чтобы строки шли
    горизонтально. Иначе у длинной наклонной строки центр оказывается ниже соседней короткой и строки
    штампа меняются местами («Р-Н ЛЕНИНСКИЙ, СВЕРДЛОВСКАЯ ОБЛ.»). Сами строки уже прочитаны по
    выпрямленным вырезкам; вырезки с фото (код подразделения, номер на полях) — по img_box."""
    angles = [np.degrees(np.arctan2(*(l["poly"][1] - l["poly"][0])[::-1]))
              for l in lines if l["w"] > 3 * l["h"] and len(l["text"].strip()) >= 4]
    if len(angles) < 3:
        return
    a = float(np.median(angles))
    if abs(a) < 1.0 or abs(a) > 30.0:
        return
    t = np.radians(-a)
    c, s = np.cos(t), np.sin(t)
    pts = np.concatenate([l["poly"] for l in lines])
    o = (pts.min(axis=0) + pts.max(axis=0)) / 2
    for l in lines:
        q = (l["poly"] - o) @ np.array([[c, s], [-s, c]]) + o
        x0, y0 = q.min(axis=0)
        x1, y1 = q.max(axis=0)
        l.update(x0=x0, y0=y0, x1=x1, y1=y1, cx=(x0 + x1) / 2, cy=(y0 + y1) / 2, w=x1 - x0, h=y1 - y0)


def img_box(l):
    """Рамка строки на самом фото (до выпрямления координат в deskew_lines): для вырезок."""
    x0, y0, x1, y1 = l.get("img_box") or (l["x0"], l["y0"], l["x1"], l["y1"])
    return {"x0": x0, "y0": y0, "x1": x1, "y1": y1, "cx": (x0 + x1) / 2, "cy": (y0 + y1) / 2, "w": x1 - x0, "h": y1 - y0}


def sharpness(path):
    g = cv2.imdecode(np.fromfile(str(path), np.uint8), cv2.IMREAD_GRAYSCALE)
    return float(cv2.Laplacian(g, cv2.CV_64F).var())


# ---------------- общие помощники шаблонов ----------------

def flat_text(lines):
    """Весь текст одной строкой: верхний регистр, без пробелов и дефисов, латинские двойники → русские.
    Штампы набирают вразрядку («З А Р Е Г И С Т Р И Р О В А Н») — так они тоже находятся."""
    return re.sub(r"[\s\-]", "", " ".join(l["text"] for l in lines).upper()).translate(LAT2CYR)


PASSPORT_MARKS = ("ПАСПОРТВЫДАН", "КОДПОДРАЗДЕЛЕНИЯ", "ДАТАВЫДАЧИ", "ФАМИЛИЯ", "ОТЧЕСТВО",
                  "МЕСТОРОЖДЕНИЯ", "ЛИЧНАЯПОДПИСЬ", "ДАТАРОЖДЕНИЯ")


def doc_type(lines):
    flat = flat_text(lines)
    raw = " ".join(l["text"].upper() for l in lines)
    # доверенность первой: в ней есть «фамилия, имя, отчество» и паспортные данные представителя
    if "ДОВЕРЕННОСТЬ" in flat and ("ДЕЙСТВИТЕЛЬНА" in flat or "ДОВЕРЕННОСТЬ№" in flat or "ВЫДАНА" in flat):
        return "poa"
    if "ВОДИТЕЛЬСК" in flat or "DRIVING" in raw:
        return "driver_license"
    if "СВИДЕТЕЛЬСТВО" in flat and ("РЕГИСТРАЦ" in flat or "ТРАНСПОРТН" in flat):
        return "vehicle_registration"
    if "СОБСТВЕННИК" in flat and ("ГИБДД" in flat or "ОСОБЫЕОТМЕТКИ" in flat or "СУБЪЕКТ" in flat):
        return "vehicle_registration_back"
    if any(mrz_clean(l["text"]).startswith("PNRUS") or mrz_bottom(l["text"]) for l in lines):
        return "passport"
    if "ЗАРЕГИСТРИРОВАН" in flat or "МЕСТОЖИТЕЛЬСТВА" in flat:
        return "passport_registration"
    marks = sum(m in flat for m in PASSPORT_MARKS)
    margin_number = any(l["h"] > 1.5 * l["w"] and SERIES_NUMBER_RE.search(l["text"]) for l in lines)
    if marks >= 3 or (marks >= 2 and margin_number):
        return "passport"
    # изношенная страница (боевой тест Task 86): подписи бланка прочитаны неузнаваемо («ФиИ», «Or0»),
    # но структура видна — копия серии на полях вертикально, дата бланка, заглавные слова столбца ФИО
    if margin_number and any(DATE_RE.search(l["text"]) for l in lines) \
            and sum(1 for l in lines if is_upper_word(l["text"])) >= 2:
        return "passport"
    # СТС на изношенном скане (боевой тест Task 86): заголовок «СВИДЕТЕЛЬСТВО» не дочитан,
    # но бланк узнаваем по подписям полей («Паспорт ТС №», массы, VIN, госномер).
    # Проверка после паспорта: номер серии СТС совпадает по виду с серией паспорта.
    if "ПАСПОРТТС" in flat or "МАКСМАССА" in flat or "МАССАВСНАРЯЖ" in flat \
            or "ГОСНОМЕР" in flat or "VIN" in raw.upper():
        return "vehicle_registration"
    return "unknown"


def same_row_right(lines, anchor):
    row = [l for l in lines if l is not anchor and abs(l["cy"] - anchor["cy"]) < 0.6 * max(l["h"], anchor["h"]) and l["x0"] > anchor["x0"]]
    return sorted(row, key=lambda l: l["x0"])


def right_of(lines, anchor):
    """Ближайшее значение справа от подписи в той же строке документа."""
    row = same_row_right(lines, anchor)
    return row[0] if row else None


def label_like(text, word):
    """Мелкая подпись бланка, прочитанная с ошибкой: «Meero» — «МЕСТО», «рожления» — «РОЖДЕНИЯ».
    word — подпись целиком; совпадение начала слова или не больше 1 ошибки (2 — у слов от 5 букв)."""
    t = cyr(text).replace("Ё", "Е")
    if word[:max(4, len(word) - 2)] in t:   # «МЕСТ», «РОЖДЕН» — как раньше
        return True
    maxd = 2 if len(word) >= 5 else 1
    return any(abs(len(tok) - len(word)) <= 1 and _lev(tok, word) <= maxd for tok in re.findall(r"[А-Я0-9]+", t))


def near_label(lines, word, pred, up=4.0, down=1.5):
    """Значение у мелкой подписи паспорта: правее подписи и чуть выше неё.
    word — начало подписи («мест») или подпись целиком в верхнем регистре («МЕСТО») — тогда
    подпись узнаётся и прочитанной с ошибкой."""
    exact = word.isupper()
    lab = next((l for l in lines if (label_like(l["text"], word) if exact else word.upper() in cyr(l["text"]))), None)
    if not lab:
        return None
    c = [l for l in lines if l is not lab and l["x0"] > lab["x0"] + 2 * lab["h"] and
         -up * lab["h"] < l["cy"] - lab["cy"] < down * lab["h"] and pred(l["text"])]
    return min(c, key=lambda l: abs(l["cy"] - lab["cy"])) if c else None


def latin_below(lines, v):
    """Латинская строка-транслитерация сразу под значением (так устроено ВУ)."""
    c = [l for l in lines if l is not v and abs(l["x0"] - v["x0"]) < 3 * v["h"] and 0 < l["cy"] - v["cy"] < 2.2 * v["h"]
         and re.fullmatch(r"[A-Z' \-]+", l["text"].strip().upper())]
    return min(c, key=lambda l: l["cy"]) if c else None


def is_upper_word(t):
    # Ё/ё — вне диапазонов А-Я/а-я: без них «ПЁТР», «СЕМЁН» не считаются словами (Task 84, живой тест)
    return bool(re.search(r"[A-Za-zА-Яа-яЁё]{3}", t)) and t.upper() == t


def field(value, src):
    return {"value": value, "conf": round(src["conf"], 3) if src else None, "line": src}


def ru_field(src, value):
    """Поле ФИО: буквы заново выбираются только среди русских (см. RUSSIAN_ONLY). Цифры, похожие
    на буквы («3ЕБКИН»), переносят свой голос на русскую букву. Если значение — хвост строки после
    номера подписи («1. ИВАНОВ»), перечитываем всю строку и берём буквенную часть."""
    f = field(cyr(value).translate(DIGIT_TWINS) if value else None, src)
    if RUSSIAN_ONLY and src and src.get("probs") and value and value.strip() in src["text"]:
        text, score = greedy(*src["probs"], allowed=RUSSIAN)
        text = re.sub(r"\s+", " ", text).strip()
        letters = lambda t: len(re.sub(r"[^А-ЯA-Z0-9]", "", t.upper()))
        if text and abs(letters(text) - letters(value)) <= 2:
            f["value"], f["conf"] = text, round(score, 3)
    return f


def _lex_hit(word, kind):
    """Слово в словаре точно или с одной опечаткой («БЛАДИМИРОВИЧ» → «ВЛАДИМИРОВИЧ»), иначе None."""
    w = cyr(word).replace("Ё", "Е").strip(".").upper()
    lex = lex_words(kind)
    if w in lex:
        return w
    near = lex_near(w, kind, 1)
    return min(near, key=lambda v: _lev(v, w)) if near else None


def helper_ocr():
    """Перечитывание мелких полей (код, номер на полях) — той же единственной моделью (Task 86)."""
    return get_ocr()


def reread_code(path, f):
    """Код подразделения («123-456»): первая цифра часто читается неверно («223»). Вырезку строки
    увеличиваем вдвое и читаем точной моделью; берём чтение, в котором нейросеть увереннее."""
    l = f["line"]
    if not l:
        return f
    img = cv2.imdecode(np.fromfile(str(path), np.uint8), cv2.IMREAD_COLOR)
    b = img_box(l)
    pad = int(0.4 * b["h"])
    crop = img[max(0, int(b["y0"]) - pad):int(b["y1"]) + pad, max(0, int(b["x0"]) - pad):int(b["x1"]) + pad]
    if crop.size == 0:
        return f
    big = cv2.resize(crop, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
    res = helper_ocr().predict(big, use_textline_orientation=False,
                               text_det_limit_side_len=det_side_for(*big.shape[:2]), text_det_limit_type="max")[0]
    for t, sc in zip(res["rec_texts"], res["rec_scores"]):
        m = re.fullmatch(r"\s*(\d{3})\s?[-–]\s?(\d{3})\s*", t)
        if m and float(sc) > (f["conf"] or 0):
            return {"value": f"{m.group(1)}-{m.group(2)}", "conf": round(float(sc), 3), "line": l}
    return f


# ---------------- паспорт: серия и номер на полях страницы ----------------

def read_margin_number(path, lines):
    """Серия и номер напечатаны вертикально на полях обеих страниц. Вырезаем эту полосу, поворачиваем,
    увеличиваем и читаем ещё раз. Проверку ориентации строк здесь выключаем: на коротких цифрах (0, 3, 8)
    она путает верх и низ. Вместо неё читаем оба поворота и берём тот, где номер нашёлся."""
    # номер на полях — длинная вертикальная строка цифр; одиночная «цифра» (пятно, край голограммы)
    # растянула бы полосу на всю страницу: чтение в 9 раз дольше и хуже
    vertical = [l for l in lines if l["h"] > 1.5 * l["w"] and sum(c.isdigit() for c in l["text"]) >= 4]
    if not vertical:
        return []
    img = cv2.imdecode(np.fromfile(str(path), np.uint8), cv2.IMREAD_COLOR)
    x0, x1 = int(min(img_box(l)["x0"] for l in vertical)), int(max(img_box(l)["x1"] for l in vertical))
    pad = int(0.6 * (x1 - x0))
    col = img[:, max(0, x0 - pad):min(img.shape[1], x1 + pad)]
    best = []
    for rot in (cv2.ROTATE_90_COUNTERCLOCKWISE, cv2.ROTATE_90_CLOCKWISE):
        strip = cv2.resize(cv2.rotate(col, rot), None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
        # строки ищем на полосе с лимитом по площади входа (было: сторона ≤ 2000 px),
        # читаются они с увеличенной полосы
        res = helper_ocr().predict(strip, use_textline_orientation=False,
                                          text_det_limit_side_len=det_side_for(*strip.shape[:2]), text_det_limit_type="max")[0]
        toks = sorted((float(np.array(p)[:, 0].min()), t.strip(), float(s))
                      for t, s, p in zip(res["rec_texts"], res["rec_scores"], res["rec_polys"]) if re.fullmatch(r"\d[\d ]*", t.strip()))
        found, i = [], 0
        while i < len(toks):
            for j in range(i + 1, min(i + 4, len(toks) + 1)):
                m = SERIES_NUMBER_RE.fullmatch(" ".join(t for _, t, _ in toks[i:j]))
                if m:
                    found.append({"series": m.group(1) + m.group(2), "number": m.group(3),
                                  "conf": round(float(np.mean([s for _, _, s in toks[i:j]])), 3)})
                    i = j - 1
                    break
            i += 1
        if len(found) > len(best) or (found and len(found) == len(best) and max(c["conf"] for c in found) > max(c["conf"] for c in best)):
            best = found
    return best


# ---------------- паспорт: машиночитаемая зона (МЧЗ) ----------------

# Внутренний паспорт РФ: две строки по 44 знака внизу страницы с фото. Кириллица записана
# по таблице МВД — один латинский знак на букву, поэтому имя восстанавливается точно.
MRZ_CYR = dict(zip("ABVGDE2JZIQKLMNOPRSTUFHC34WXY9678", "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ"))
MRZ_DIGIT_LETTERS = str.maketrans("015", "OIS")   # в имени цифр 0, 1, 5 не бывает — это буквы


def mrz_clean(t):
    """Строка МЧЗ: латиница, цифры и «<»; кириллические двойники и пробелы убираются."""
    return re.sub(r"\s+", "", (t or "").upper().translate(CYR2LAT)).replace("«", "<").replace("‹", "<")


def mrz_bottom(t):
    """Вторая строка МЧЗ, выровненная по «RUS» (перед ним 9 цифр номера и контрольная), или None."""
    c = mrz_clean(t)
    i = c.find("RUS", 10)
    if i < 10 or not re.fullmatch(r"\d{10}", c[i - 10:i]):
        return None
    return (c[i - 10:] + "<" * 44)[:44]


def mrz_check(chars):
    """Контрольная цифра ICAO 9303: веса 7-3-1, буквы A=10…Z=35, «<» = 0."""
    total = 0
    for i, ch in enumerate(chars):
        v = int(ch) if ch.isdigit() else (ord(ch) - 55 if "A" <= ch <= "Z" else 0)
        total += v * (7, 3, 1)[i % 3]
    return str(total % 10)


def mrz_date(yymmdd):
    if not re.fullmatch(r"\d{6}", yymmdd):
        return None
    yy = int(yymmdd[:2])
    year = 2000 + yy if 2000 + yy <= date.today().year else 1900 + yy
    value = f"{yymmdd[4:]}.{yymmdd[2:4]}.{year}"
    return value if parse_date(value) else None


# транслитерация ICAO 9303 (загранпаспорта и образцы бланков): «IVANOVICH», а не «IVANOVI3» как у МВД
ICAO_RU = {"А": "A", "Б": "B", "В": "V", "Г": "G", "Д": "D", "Е": "E", "Ё": "E", "Ж": "ZH", "З": "Z", "И": "I",
           "Й": "I", "К": "K", "Л": "L", "М": "M", "Н": "N", "О": "O", "П": "P", "Р": "R", "С": "S", "Т": "T",
           "У": "U", "Ф": "F", "Х": "KH", "Ц": "TS", "Ч": "CH", "Ш": "SH", "Щ": "SHCH", "Ъ": "IE", "Ы": "Y",
           "Ь": "", "Э": "E", "Ю": "IU", "Я": "IA", "-": "<", " ": "<"}
MVD_RU = {**{c: l for l, c in MRZ_CYR.items()}, "-": "<", " ": "<"}
RU_LETTERS = "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ"


def mrz_forms(word):
    """Как слово с бланка записывается в МЧЗ: по таблице МВД и по ICAO 9303."""
    forms = set()
    for table in (MVD_RU, ICAO_RU):
        if all(ch in table for ch in word):
            forms.add("".join(table[ch] for ch in word))
    return forms


def mrz_correct(visual, raw, kind=None):
    """Сверка ФИО бланка с МЧЗ: (значение, исправлено) или None.
    Совпало точно — подтверждение; отличается ровно одной буквой, и исправленное слово
    совпадает с МЧЗ точно и однозначно — исправление («ИБАН» + «IVAN» → «ИВАН»).
    kind (surname/name/patronymic) — словарь ФИО перевешивает: на изношенных сканах МЧЗ читается
    с ошибкой («АЛЕКСЕГ» вместо «АЛЕКСЕЙ»), а словарное имя на бланке верно — не исправляем."""
    word = re.sub(r"\s+", " ", cyr(visual or "")).strip()
    if not word or not raw:
        return None
    targets = {raw, raw.translate(MRZ_DIGIT_LETTERS)}
    if mrz_forms(word) & targets:
        return word, False
    found = set()
    for i in range(len(word) + 1):
        variants = [word[:i] + ch + word[i:] for ch in RU_LETTERS]                    # пропущенная буква
        if i < len(word):
            variants += [word[:i] + ch + word[i + 1:] for ch in RU_LETTERS]           # неверная буква
            variants.append(word[:i] + word[i + 1:])                                  # лишняя буква
        found.update(v for v in variants if v and mrz_forms(v) & targets)
    if len(found) == 1:
        fixed = found.pop()
        if kind in ("name", "patronymic") and word in lex_words(kind) and fixed not in lex_words(kind):
            return word, False   # словарь уверен в прочтении бланка — МЧЗ-вариант с ошибкой
        return fixed, True
    return None


def mrz_name(part):
    part = part.translate(MRZ_DIGIT_LETTERS)
    return "".join(MRZ_CYR[ch] for ch in part) if part and all(ch in MRZ_CYR for ch in part) else None


def read_mrz(lines):
    """Поля из МЧЗ: {ключ: (значение, контрольная цифра сошлась, уверенность строки)}.
    Номер, даты и код проверяются контрольными цифрами; в строке с ФИО контрольных цифр нет.
    None — строк МЧЗ на фото нет."""
    top = next((l for l in lines if mrz_clean(l["text"]).startswith("PNRUS")), None)
    bottom = next((l for l in lines if mrz_bottom(l["text"])), None)
    if not top and not bottom:
        return None
    out = {}
    if bottom:
        b = mrz_bottom(bottom["text"])
        conf = bottom["conf"]
        doc, birth, opt = b[0:9], b[13:19], b[28:42]
        ok_doc, ok_birth, ok_opt = mrz_check(doc) == b[9], mrz_check(birth) == b[19], mrz_check(opt) == b[42]
        if re.fullmatch(r"\d{9}", doc) and b[28].isdigit():
            series = doc[:3] + b[28]   # 4-я цифра серии — в дополнительных данных
            out["series_number"] = (f"{series[:2]} {series[2:]} {doc[3:]}", ok_doc and ok_opt, conf)
        out["birth_date"] = (mrz_date(birth), ok_birth, conf)
        out["issue_date"] = (mrz_date(b[29:35]), ok_opt, conf)
        if re.fullmatch(r"\d{6}", b[35:41]):
            out["dept"] = (f"{b[35:38]}-{b[38:41]}", ok_opt, conf)
        # контрольные цифры номера и даты рождения сошлись — строки в формате МВД, им можно верить
        out["genuine"] = ok_doc and ok_birth
    if top:
        names = mrz_clean(top["text"])[5:].rstrip("<")
        surname, _, rest = names.partition("<<")
        given = [x for x in rest.split("<") if x]
        for key, part in (("surname", surname), ("name", given[0] if given else ""),
                          ("patronymic", given[1] if len(given) > 1 else "")):
            out[key] = (mrz_name(part), False, top["conf"])
            out[key + "_raw"] = part   # латиницей — для сверки с бланком (mrz_correct)
    return out


def issued_by(lines, f):
    """«Паспорт выдан»: заглавные строки над датой выдачи и кодом подразделения, под шапкой
    «РОССИЙСКАЯ ФЕДЕРАЦИЯ». Вписанное от руки читается с низкой уверенностью — платформа его не подставит."""
    anchors = [x["line"] for x in (f["issue_date"], f["dept"]) if x.get("line")]
    if not anchors:
        return field(None, None)
    anchor = min(anchors, key=lambda l: l["cy"])
    head = next((l for l in lines if l["cy"] < anchor["cy"]
                 and re.search(r"РОССИЙСК|ФЕДЕРАЦ", re.sub(r"\s", "", cyr(l["text"])))), None)
    lo = head["cy"] + 0.5 * head["h"] if head else anchor["cy"] - 6 * anchor["h"]
    parts = [l for l in lines
             if lo < l["cy"] < anchor["cy"] - 0.6 * anchor["h"] and l["w"] > l["h"]
             and re.search(r"[А-ЯЁ]{2}", cyr(l["text"])) and not re.search(r"\d|ВЫДАН", cyr(l["text"]))
             and l["text"] == l["text"].upper()]
    if not parts:
        return field(None, None)
    # по рядам сверху вниз, в ряду — слева направо (округление cy/h ставило соседние строки разной
    # высоты в один ряд: «ПО ГОР. МОСКВЕ … ОТДЕЛОМ УФМС РОССИИ»)
    parts = [l for r in rows_of(parts) for l in r]
    text = fix_letters(re.sub(r"\s+", " ", " ".join(lex_fix(cyr(l["text"]), l, "issuer") for l in parts)).strip())
    f = field(text, min(parts, key=lambda l: l["conf"]))
    # все слова — из словаря штампов: надёжное чтение, хотя строки читались неуверенно (платформа не
    # подставляет «Кем выдан» с уверенностью ниже 0,6 — защита от рукописи, а рукопись словарь не проходит)
    tokens = [t for t in LEX_WORD_RE.findall(text) if len(t) >= 3]
    if tokens and all(t in lex_words("issuer") for t in tokens):
        f["conf"] = max(f["conf"] or 0, 0.7)
    return f


# «ГОР.» нейросеть путает с похожими по начертанию «ФОП», «ФОР», «ГОП», «ТОР»
SETTLEMENT_FIXES = re.compile(r"(^|\s)(?:ФОП|ФОР|ГОП|ТОР|Г0Р|ГОР)(?:[.,]\s*|\s+)")


def fix_letters(value):
    """«КОJIОМНА» → «КОЛОМНА»: «Л» нейросеть часто читает как латинские «JI»; «УI»/«УJ» — «УЛ»."""
    if not value:
        return value
    return re.sub(r"(?<![А-ЯA-Z])У[IІl|J](?![А-ЯA-Z])", "УЛ.", value.replace("JI", "Л"))


# обрывок перед названием: «Г.», прочитанное как «F», греческая «Γ», «r»; «С.», «П.»
PREFIX_SHAPES = ((re.compile(r"^(?:ГОР|ТОР|ФОР)[.,]?$"), "ГОР."), (re.compile(r"^[ГΓFTr][.,:]?$"), "Г."),
                 (re.compile(r"^[СC][.,]$"), "С."), (re.compile(r"^П[.,]$"), "П."), (re.compile(r"^ПОС[.,]?$"), "ПОС."))
# сокращение без точки: «Г ТУАПСЕ» → «Г. ТУАПСЕ»
ABBR_NO_DOT = re.compile(r"(^|\s)(Г|С|П|Д|Х|ПОС|ДЕР|УЛ|КВ)\s+(?=[А-Я0-9])")


def settlement_prefix(lines, place):
    """Короткий обрывок слева от названия в той же строке — сокращение «Г.», «С.», «П.» или ""."""
    near = [l for l in lines if l is not place and abs(l["cy"] - place["cy"]) < 0.6 * max(l["h"], place["h"])
            and place["x0"] - 3 * place["h"] < l["x1"] <= place["x0"] + 0.3 * place["h"] and len(l["text"].strip()) <= 4]
    for l in sorted(near, key=lambda l: -l["x1"]):
        t = l["text"].strip().upper().translate(LAT2CYR)
        for shape, value in PREFIX_SHAPES:
            if shape.match(t) or shape.match(l["text"].strip()):
                return value
    return ""


def fix_settlement(value):
    if not value:
        return value
    value = SETTLEMENT_FIXES.sub(lambda m: m.group(1) + "ГОР. ", value).strip()
    return ABBR_NO_DOT.sub(lambda m: f"{m.group(1)}{m.group(2)}. ", value)


def above_value(lines, anchor, pred, rows=6.0):
    """Ближайшая строка над значением, по центру того же столбца (фамилия над именем)."""
    c = [l for l in lines if l is not anchor and pred(l["text"]) and 0 < anchor["cy"] - l["cy"] < rows * anchor["h"]
         and abs(l["cx"] - anchor["cx"]) < 0.6 * max(l["w"], anchor["w"])]
    return min(c, key=lambda l: anchor["cy"] - l["cy"]) if c else None


def extract_passport(path, lines):
    if os.environ.get("OCR_DEBUG_FIO"):
        print(f"[fio] extract_passport: строк={len(lines)}: {[l['text'][:20] for l in lines]}", flush=True)
    f = {}
    for key, word in (("surname", "фамил"), ("name", "имя"), ("patronymic", "отчеств")):
        v = near_label(lines, word, is_upper_word)
        f[key] = ru_field(v, v["text"] if v else None)
    if not f["patronymic"]["value"] and f["name"]["line"]:
        # подпись «Отчество» не прочиталась: отчество — строка под именем, в том же столбце
        nm = f["name"]["line"]
        c = [l for l in lines if l is not nm and 0 < l["cy"] - nm["cy"] < 3.0 * nm["h"] and abs(l["cx"] - nm["cx"]) < 0.6 * max(l["w"], nm["w"])
             and is_upper_word(l["text"]) and not re.search(r"\d|МУЖ|ЖЕН", cyr(l["text"]))]
        v = min(c, key=lambda l: l["cy"]) if c else None
        f["patronymic"] = ru_field(v, v["text"] if v else None)
    if not f["surname"]["value"] and f["name"]["line"]:
        # мелкая подпись «Фамилия» не прочиталась (старый паспорт, скан страницы А4): фамилия — над именем
        v = above_value(lines, f["name"]["line"], lambda t: is_upper_word(t) and not re.search(r"\d|РОССИЙ|ФЕДЕРАЦ", t.upper()))
        f["surname"] = ru_field(v, v["text"] if v else None)
    if not f["name"]["value"] and f["surname"]["line"] and f["patronymic"]["line"]:
        # подпись «Имя» не прочиталась: имя — строка между фамилией и отчеством, в том же столбце
        top, bottom = f["surname"]["line"], f["patronymic"]["line"]
        c = [l for l in lines if l is not top and l is not bottom and top["cy"] < l["cy"] < bottom["cy"]
             and abs(l["cx"] - top["cx"]) < 0.8 * max(l["w"], top["w"]) and is_upper_word(l["text"]) and not re.search(r"\d", l["text"])]
        v = min(c, key=lambda l: abs(l["cy"] - (top["cy"] + bottom["cy"]) / 2)) if c else None
        f["name"] = ru_field(v, v["text"] if v else None)
    ref = None   # якорь столбца ФИО: дата рождения рядом с полом (фолбэк даты рождения ниже)
    if not all(f[k]["value"] for k in ("surname", "name", "patronymic")):
        # подписи «Фамилия», «Имя», «Отчество» прочитаны неузнаваемо («2», «HME»): ФИО — три строки
        # заглавными в столбце значений над строкой «МУЖ./ЖЕН.» и датой рождения
        sex = next((l for l in lines if re.search(r"МУЖ|ЖЕН", cyr(l["text"]))), None)
        col = []
        if sex:
            row = [l for l in lines if DATE_RE.search(l["text"]) and abs(l["cy"] - sex["cy"]) < 1.5 * sex["h"]]
            ref = max(row, key=lambda l: l["w"]) if row else sex
        else:
            # «МУЖ./ЖЕН.» не прочитался (боевой скан Task 85): якорим на самую нижнюю дату
            # страницы — дата рождения стоит рядом с полом, столбец ФИО выше неё
            dates = [l for l in lines if DATE_RE.search(l["text"])]
            ref = max(dates, key=lambda l: l["cy"]) if dates else None
        if ref:
            col = sorted((l for l in lines if 0.5 * ref["h"] < ref["cy"] - l["cy"] < 12 * ref["h"]
                          and ref["x0"] - 2 * ref["h"] < l["cx"] < ref["x1"] and is_upper_word(l["text"])
                          and not re.search(r"\d|РОССИЙ|ФЕДЕРАЦ|ПАСПОРТ", cyr(l["text"]))), key=lambda l: l["cy"])
            if len(col) >= 3:
                for key, l in zip(("surname", "name", "patronymic"), col[-3:]):
                    if not f[key]["value"]:
                        f[key] = ru_field(l, l["text"])
            elif len(col) == 2:
                # две из трёх строк: на бланке порядок всегда фамилия → имя → отчество,
                # какую из них не хватает подсказывает лексикон: хвост-отчество («…ОВИЧ/ОВНА»)
                # или имя (Task 85)
                low_pat = _lex_hit(col[-1]["text"], "patronymic")
                low_name = _lex_hit(col[-1]["text"], "name")
                if low_pat and not low_name:
                    if not f["surname"]["value"]:
                        f["surname"] = ru_field(col[-2], col[-2]["text"])
                    if not f["patronymic"]["value"]:
                        f["patronymic"] = ru_field(col[-1], low_pat)
                elif low_name and not low_pat:
                    if not f["surname"]["value"]:
                        f["surname"] = ru_field(col[-2], col[-2]["text"])
                    if not f["name"]["value"]:
                        f["name"] = ru_field(col[-1], low_name)
            if os.environ.get("OCR_DEBUG_FIO"):
                fio_now = {k: f[k]["value"] for k in ("surname", "name", "patronymic")}
                print(f"[fio] sex={sex and sex['text']!r} col={[(l['text'], round(l['cy']), round(l['cx'])) for l in col]} ФИО={fio_now}", flush=True)
    # имя и отчество — из словаря имён («ИБАН» → «ИВАН»), если нейросеть допускала такое чтение
    for key, kind in (("name", "name"), ("patronymic", "patronymic")):
        if f[key]["value"] and f[key]["line"]:
            f[key]["value"] = lex_fix(f[key]["value"], f[key]["line"], kind)
    place = near_label(lines, "МЕСТО", lambda t: bool(re.search(r"[А-ЯЁ]{3}", cyr(t))) and not DATE_RE.search(t) and t.upper() == t, up=2.0, down=3.0)
    if not place:
        # «Дата рождения» и «Место рождения»: подпись «Место» мелкая и теряется — берём нижнюю «рождения»
        labs = sorted((l for l in lines if label_like(l["text"], "РОЖДЕНИЯ")), key=lambda l: -l["cy"])
        ok = lambda t: bool(re.search(r"[А-ЯЁ]{3}", cyr(t))) and not DATE_RE.search(t) and t.upper() == t and not re.search(r"МУЖ|ЖЕН", cyr(t))
        for lab in labs:
            c = [l for l in lines if l is not lab and l["x0"] > lab["x0"] + lab["h"] and -2.5 * lab["h"] < l["cy"] - lab["cy"] < 1.5 * lab["h"] and ok(l["text"])]
            if c:
                place = min(c, key=lambda l: abs(l["cy"] - lab["cy"]))
                break
    prefix = settlement_prefix(lines, place) if place else ""
    if place:
        # место рождения бывает в две строки («Г. ТУАПСЕ» / «КРАСНОДАРСКИЙ КРАЙ») — склеиваем столбец
        parts, cur = [place], place
        for _ in range(2):
            nxt = next((l for l in lines if l not in parts and 0 < l["cy"] - cur["cy"] < 1.8 * cur["h"]
                        and abs(l["cx"] - cur["cx"]) < 0.6 * max(l["w"], cur["w"]) and l["text"].upper() == l["text"]
                        and re.search(r"[А-ЯЁ]{3}", cyr(l["text"])) and not re.search(r"\d", l["text"])), None)
            if not nxt:
                break
            parts.append(nxt)
            cur = nxt
        if len(parts) == 1:
            f["birth_place"] = ru_field(place, place["text"])
            # повторное чтение русскими буквами теряет точку («ТОР.МОСКВА» → «ТОРМОСКВА»):
            # сокращение, узнанное в исходном тексте, сохраняем
            raw = cyr(place["text"])
            if fix_settlement(raw) != raw:
                f["birth_place"]["value"] = raw
            f["birth_place"]["value"] = lex_fix(f["birth_place"]["value"], place, "place")
        else:
            f["birth_place"] = field(" ".join(lex_fix(cyr(l["text"]), l, "place") for l in parts), min(parts, key=lambda l: l["conf"]))
        if prefix and not re.match(r"^(Г|ГОР|С|П|ПОС|Д|ДЕР|Х|СТ-ЦА|РП|ПГТ)\b", f["birth_place"]["value"] or ""):
            f["birth_place"]["value"] = f"{prefix} {f['birth_place']['value']}"
        f["birth_place"]["value"] = fix_settlement(f["birth_place"]["value"])
    else:
        f["birth_place"] = field(None, None)
    v = near_label(lines, "рожд", lambda t: bool(DATE_RE.search(t)))
    if not v and ref is not None and DATE_RE.search(ref["text"]):
        # подпись «Дата рождения» не прочиталась («poxenиs», Task 85): якорная дата — рядом
        # с полом — и есть дата рождения (она самая нижняя дата страницы с фото)
        v = ref
    f["birth_date"] = field(DATE_RE.search(v["text"]).group(0) if v else None, v)
    copies = read_margin_number(path, lines)
    if copies:
        top = max(copies, key=lambda c: c["conf"])
        f["series_number"] = {"value": f"{top['series'][:2]} {top['series'][2:]} {top['number']}", "conf": top["conf"], "line": None}
    else:
        f["series_number"] = field(None, None)
    v = next((l for l in lines if re.fullmatch(r"\d{3}-\d{3}", l["text"].strip())), None)
    f["dept"] = field(v["text"].strip() if v else None, v)
    v = near_label(lines, "выдач", lambda t: bool(DATE_RE.search(t)))
    if not v and f["dept"]["line"]:
        code = f["dept"]["line"]
        c = [l for l in lines if DATE_RE.search(l["text"]) and abs(l["cy"] - code["cy"]) < 1.0 * code["h"] and l["cx"] < code["cx"]]
        v = min(c, key=lambda l: abs(l["cy"] - code["cy"])) if c else None
    f["issue_date"] = field(DATE_RE.search(v["text"]).group(0) if v else None, v)
    return f, copies


# ---------------- общие помощники для значений под подписью ----------------

def value_near(lines, label, pred, below=3.0):
    """Значение справа от подписи в той же строке или ниже неё (СТС, доверенность): первое подходящее."""
    c = [l for l in lines if l is not label and pred(l["text"]) and (
        (abs(l["cy"] - label["cy"]) < 0.6 * max(l["h"], label["h"]) and l["x0"] > label["x0"])
        or (0 < l["cy"] - label["cy"] < below * label["h"] and l["x1"] > label["x0"] - 2 * label["h"]))]
    return min(c, key=lambda l: (abs(l["cy"] - label["cy"]), l["x0"])) if c else None


def find_line(lines, *words):
    """Первая строка, содержащая все слова (без учёта регистра и пробелов)."""
    for l in lines:
        t = re.sub(r"\s", "", l["text"].upper()).translate(LAT2CYR)
        if all(w in t for w in words):
            return l
    return None


# латинские двойники в строчных буквах подписей («Мaрка», «Moдель»)
LOWER_TWINS = str.maketrans("aeopcxykmtbhAEOPCXYKMTBH", "аеорсхукмтвнАЕОРСХУКМТВН")
# цифры, прочитанные как похожие буквы в датах («З1.12.2030»)
DATE_TWINS = str.maketrans("ЗзОоOoбБ", "33000066")


def fix_date_twins(t):
    return re.sub(r"[\dЗзОоOoбБ]{2}[.,][\dЗзОоOoбБ]{2}[.,][\dЗзОоOoбБ]{4}", lambda m: m.group(0).translate(DATE_TWINS), t or "")


CAR_PLATE_RE = re.compile(r"[АВЕКМНОРСТУХ]\d{3}[АВЕКМНОРСТУХ]{2}\d{2,3}")
TRAILER_PLATE_RE = re.compile(r"[АВЕКМНОРСТУХ]{2}\d{4}\d{2,3}")
# «99 00 123456», «99  00 123456», бланк 2018+: «99 00 № 123456»
STS_NUMBER_RE = re.compile(r"(\d{2})\s*(\d{2})\s*(?:№|N[oO°º]?\.?)?\s*(\d{6})")
VIN_RE = re.compile(r"[A-HJ-NPR-Z0-9]{17}")


def as_plate(t):
    """Госномер автомобиля или прицепа; в позициях букв 0 → О (OCR путает)."""
    s = norm_plate(t)
    for cand in (s, re.sub(r"^0", "О", s), re.sub(r"^(.)0", r"\1О", s)):
        if CAR_PLATE_RE.fullmatch(cand) or TRAILER_PLATE_RE.fullmatch(cand):
            return cand
    return None


def as_vin(t):
    s = norm_vin(t).replace("O", "0").replace("I", "1").replace("Q", "0")
    return s if VIN_RE.fullmatch(s) else None


def sts_number(lines):
    """Красный номер бланка СТС «99 00 123456» (печатается внизу и вертикально на поле)."""
    c = [(l, m) for l in lines for m in [STS_NUMBER_RE.fullmatch(l["text"].strip())] if m]
    if not c:
        # крупный кадр: широкие пробелы номера режут его на куски «99» «81» «897996» одного ряда
        for row in rows_of(lines):
            m = STS_NUMBER_RE.fullmatch(" ".join(l["text"].strip() for l in row)) if len(row) > 1 else None
            if m:
                c.append(({**row[0], "conf": min(l["conf"] for l in row)}, m))
    if not c:
        return None
    best, m = max(c, key=lambda x: x[0]["conf"])
    return {"value": f"{m.group(1)} {m.group(2)} {m.group(3)}", "conf": round(best["conf"], 3), "line": best,
            "copies": len({"".join(x[1].groups()) for x in c}), "count": len(c)}


# ---------------- шаблоны ВУ, СТС, регистрации ----------------

# «1.», «4a)», а также без точки: «4a 01.02.2020» и одиночная «9» (цифры без точки — только одиночные,
# иначе «99 00 123456» прочитался бы как подпись «9»)
LABEL_RE = re.compile(r"^\s*(?:(1|2|3|5|8|9)\s*(?:[.\),:]\s*(.*)|$)|(4\s*[aаAАbвBВcсCС])\s*[.\),:]?\s*(.*))$")
SUFFIX = {"а": "a", "a": "a", "А": "a", "A": "a", "в": "b", "b": "b", "В": "b", "B": "b", "с": "c", "c": "c", "С": "c", "C": "c"}


def reread_categories(path, lab):
    """Поле 9: короткие «B», «M» в квадратиках первый проход часто не замечает. От подписи «9.» вырезаем полосу
    вправо, увеличиваем в 3 раза и читаем ещё раз; оставляем только обозначения категорий."""
    img = cv2.imdecode(np.fromfile(str(path), np.uint8), cv2.IMREAD_COLOR)
    H, W = img.shape[:2]
    lab = img_box(lab)
    h = lab["h"]
    x0, x1 = int(lab["x0"]), int(min(W, lab["x0"] + 30 * h))
    y0, y1 = int(max(0, lab["cy"] - 1.2 * h)), int(min(H, lab["cy"] + 1.2 * h))
    strip = cv2.resize(img[y0:y1, x0:x1], None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
    res = helper_ocr().predict(strip, use_textline_orientation=False)[0]
    found = {}
    for t, s, p in sorted(zip(res["rec_texts"], res["rec_scores"], res["rec_polys"]), key=lambda r: np.array(r[2])[:, 0].min()):
        for x in re.split(r"[,.\s|\[\]()]+", t.upper().translate(CYR2LAT)):
            x = re.sub(r"^([ABCD])[IL]", r"\g<1>1", x)   # B1 часто читается как BI
            if x in CATEGORIES and x not in found:
                found[x] = float(s)
    return found


def extract_driver_license(path, lines):
    found = [(LABEL_RE.match(l["text"]), l) for l in lines]
    found = [(m, l) for m, l in found if m]
    dotted = sorted(l["x0"] for m, l in found if re.search(r"[.\),:]", l["text"]))
    col_x = dotted[len(dotted) // 2] if dotted else None
    labels = {}
    for m, l in found:
        bare = not re.search(r"[.\),:]", l["text"])
        if bare and col_x is not None and abs(l["x0"] - col_x) > 2 * l["h"]:
            continue
        key = (m.group(1) or re.sub(r"\s", "", m.group(3)))
        rest = (m.group(2) if m.group(1) else m.group(4)) or ""
        labels.setdefault(key[0] + SUFFIX.get(key[1:], ""), (rest.strip() or None, l))

    def by_label(k):
        if k not in labels:
            return None, None
        rest, l = labels[k]
        if rest:
            return rest, l
        v = right_of(lines, l)
        return (v["text"], v) if v else (None, None)

    f = {}
    v, src = by_label("1")
    if not v and "2" in labels:
        # подпись «1.» не прочиталась: фамилия — первая кириллическая строка между шапкой и строкой «2.»
        head = max((l["cy"] for l in lines if re.search(r"УДОСТОВЕРЕНИЕ|LICENCE|CONDUIRE", l["text"].upper())), default=0)
        lab2 = labels["2"][1]
        c = [l for l in lines if l["cy"] > head + 0.3 * l["h"] and l["cy"] < lab2["cy"] - 0.5 * lab2["h"]
             and re.fullmatch(r"[А-ЯЁ\- ]{3,}", cyr(l["text"]).strip())]
        src = min(c, key=lambda l: l["cy"]) if c else None
        v = src["text"] if src else None
    head = max((l["cy"] for l in lines if re.search(r"УДОСТОВЕРЕНИЕ|LICENCE|CONDUIRE", l["text"].upper())), default=0)
    first_date = min((l["cy"] for l in lines if parse_date(l["text"])), default=None)
    band = [l for l in lines if l["cy"] > head + 0.3 * l["h"] and (first_date is None or l["cy"] < first_date - 0.3 * l["h"])
            and re.fullmatch(r"(?:\d\s*[.,]\s*)?[А-ЯЁ0-9][А-ЯЁ0-9\- ]{2,}", cyr(l["text"]).strip())
            and re.search(r"[А-ЯЁ]{3}", cyr(l["text"]))]
    band.sort(key=lambda l: l["cy"])
    strip_num = lambda t: re.sub(r"^\s*\d\s*[.,]\s*", "", t).strip() if t else t
    if not v and band:
        src, v = band[0], strip_num(band[0]["text"])
    f["surname"] = ru_field(src, strip_num(v))
    v, src = by_label("2")
    if not v:
        rest = [l for l in band if l is not f["surname"]["line"] and (f["surname"]["line"] is None or l["cy"] > f["surname"]["line"]["cy"])]
        if rest:
            src, v = rest[0], strip_num(rest[0]["text"])
    f["name"] = ru_field(src, strip_num(v))
    dated = sorted([(parse_date(l["text"]), l) for l in lines if parse_date(l["text"])], key=lambda t: t[0])
    v3, s3 = by_label("3")
    birth = (v3, s3) if parse_date(v3) else ((dated[0][1]["text"], dated[0][1]) if dated else (None, None))
    f["birth_date"] = field(DATE_RE.search(birth[0]).group(0) if birth[0] else None, birth[1])
    v4a, s4a = by_label("4a")
    if not parse_date(v4a):
        s4a = next((l for l in lines if re.search(r"4\s*[aаAА]\)?\s", l["text"]) and parse_date(l["text"])), None)
        v4a = s4a["text"] if s4a else None
    f["issue_date"] = field(DATE_RE.search(v4a).group(0) if v4a else None, s4a)
    exp = next((l for l in lines if re.search(r"4\s*[bвBВ]\)?\s", l["text"]) and parse_date(l["text"])), dated[-1][1] if dated else None)
    f["expiry_date"] = field(DATE_RE.search(exp["text"]).group(0) if exp else None, exp)
    num = next((l for l in lines if re.fullmatch(r"(5\.\s*)?\d{2}\s?[\dА-ЯA-Z]{2}\s?\d{6}", l["text"].strip())), None)
    f["number"] = field(re.sub(r"^5\.\s*", "", num["text"]).strip() if num else None, num)
    # категории: всё, что в строке «9.» и правее неё, плюс повторное чтение этой полосы крупнее
    cat_line, tokens, again = None, [], {}
    if "9" in labels:
        rest, lab = labels["9"]
        row = same_row_right(lines, lab)
        cat_line = row[0] if row else lab
        for t in ([rest] if rest else []) + [l["text"] for l in row]:
            tokens += [x for x in re.split(r"[,\s|]+", t.upper().translate(CYR2LAT)) if x in CATEGORIES]
        again = reread_categories(path, lab)
    cats = [c for c in CAT_ORDER if c in tokens or c in again]
    f["categories"] = field(", ".join(cats) if cats else None, cat_line)
    f["categories"]["reread_agrees"] = bool(tokens) and set(tokens) == set(again)
    if again:   # оценка поля — по самой неуверенной категории из повторного чтения
        f["categories"]["conf"] = round(min(again.values()), 3)
    return f


# цвета из СТС («Белый», «ЧЕРНЫЙ», «ТЕМНО-СИНИЙ»): подпись «Цвет» на бланке часто перекрыта —
# тогда значение узнаём по самому слову
COLOR_WORDS = ("БЕЛЫЙ", "ЧЕРНЫЙ", "СЕРЫЙ", "СИНИЙ", "КРАСНЫЙ", "ЗЕЛЕНЫЙ", "ЖЕЛТЫЙ", "ОРАНЖЕВЫЙ", "КОРИЧНЕВЫЙ",
               "ГОЛУБОЙ", "СЕРЕБРИСТЫЙ", "БЕЖЕВЫЙ", "ФИОЛЕТОВЫЙ", "БОРДОВЫЙ", "БЕЛО", "ЧЕРНО", "СЕРО", "СИНЕ", "ТЕМНО",
               "СВЕТЛО", "РАЗНОЦВЕТНЫЙ", "ХАКИ", "ЗОЛОТИСТЫЙ", "ВИШНЕВЫЙ", "ПЕСОЧНЫЙ")
COLOR_RE = re.compile(r"^(?:(?:%s)[А-Я]*)(?:[\s-]+(?:%s)[А-Я]*)*$" % ("|".join(COLOR_WORDS), "|".join(COLOR_WORDS)))


def sts_color(lines):
    """«Цвет Белый»: значение в строке подписи или правее; иначе — строка из одного слова-цвета."""
    for l in lines:
        t = cyr(l["text"]).replace("Ё", "Е")
        m = re.match(r"^\s*ЦВЕТ\s*[:.]?\s*(.*)$", t)
        if not m:
            continue
        val = m.group(1).strip()
        if not val:
            r = right_of(lines, l)
            val, l = (cyr(r["text"]).replace("Ё", "Е").strip(), r) if r else ("", l)
        if val and COLOR_RE.match(re.sub(r"[^А-Я\s-]", "", val).strip()):
            return field(val, l)
    for l in lines:
        t = re.sub(r"[^А-Я\s-]", "", cyr(l["text"]).replace("Ё", "Е")).strip()
        if t and COLOR_RE.match(t):
            return field(t, l)
    return field(None, None)


def plausible_brand(value):
    """«Марка»: не подпись бланка («Модель», «Тип ТС»), не VIN и хотя бы две буквы."""
    v = (value or "").strip()
    if len(re.findall(r"[A-Za-zА-Яа-яЁё]", v)) < 2 or as_vin(v):
        return False
    return not re.fullmatch(r"(?i)\W*(модель|марка|тип(\s+тс)?|категория|шасси|кузов|цвет)\W*", v)


def extract_vehicle_registration(lines):
    """Лицевая сторона СТС: значения напечатаны ПОД подписями (раньше искали только справа)."""
    f = {}
    lab = find_line(lines, "РЕГИСТРАЦИОННЫЙ")
    v = value_near(lines, lab, as_plate) if lab else None
    if not v:
        v = next((l for l in lines if as_plate(l["text"])), None)
    f["plate"] = field(as_plate(v["text"]) if v else None, v)
    lab = find_line(lines, "ИДЕНТИФИКАЦ")
    v = value_near(lines, lab, as_vin) if lab else None
    if not v:
        v = next((l for l in lines if as_vin(l["text"])), None)
    f["vin"] = field(as_vin(v["text"]) if v else None, v)
    # «Марка SCHMITZ S.KO»: подпись и значение часто читаются одной строкой
    brand = None
    for word in ("марка", "модель"):   # у СТС марка и модель обычно совпадают — модель как запасной вариант
        for l in lines:
            t = l["text"].translate(LOWER_TWINS)
            m = re.match(rf"^\s*{word}\s*[:.]?\s*(.*)$", t, re.I)
            if not m:
                continue
            val = l["text"][len(l["text"]) - len(m.group(1)):].strip() if m.group(1) else ""
            if val[:1] in ",.;:-–—":
                # «Марка, модель» — хвост подписи, а не значение: ищем значение правее (Task 83, живой тест)
                val = ""
            if len(val) >= 2:
                brand = field(val, l)
            else:
                r = right_of(lines, l)
                brand = field(r["text"].strip(), r) if r else None
            if brand:
                break
        if brand:
            break
    if not brand and f["vin"]["line"]:
        vl = f["vin"]["line"]
        for l in sorted((l for l in lines if 0 < l["cy"] - vl["cy"] < 4 * vl["h"]), key=lambda l: l["cy"]):
            m = re.search(r"(?<![A-Za-z])([A-Z][A-Z0-9\-]{2,}(?:\s+[A-Z0-9][A-Z0-9\-]*)*)\s*$", l["text"])
            if m and not as_vin(m.group(1)):
                brand = field(m.group(1), l)
                break
    if brand and not plausible_brand(brand["value"]):
        brand = None
    f["brand"] = brand or field(None, None)
    n = sts_number(lines)
    f["sts"] = {"value": n["value"], "conf": n["conf"], "line": n["line"]} if n else field(None, None)
    f["color"] = sts_color(lines)
    f["owner"] = field(None, None)   # собственник — на обороте
    return f, n


def extract_sts_back(lines):
    """Оборот СТС: собственник (часто лизингополучатель), лизингодатель и срок временного учёта."""
    f = {}
    lab = find_line(lines, "СОБСТВЕННИК", "ВЛАДЕЛЕЦ")
    if not lab:
        # заголовок прочитан не целиком: верхняя строка со «СОБСТВЕННИК», но не из «Особых отметок»
        cands = [l for l in lines if "СОБСТВЕННИК" in re.sub(r"\s", "", l["text"].upper()).translate(LAT2CYR)
                 and "ЛИЗИНГОДАТ" not in l["text"].upper().translate(LAT2CYR)]
        lab = min(cands, key=lambda l: l["cy"]) if cands else None
    stop = find_line(lines, "СУБЪЕКТ")
    owner_lines = []
    if lab:
        owner_lines = [l for l in lines if l is not lab and l["cy"] > lab["cy"] + 0.4 * lab["h"]
                       and (stop is None or l["cy"] < stop["cy"] - 0.4 * stop["h"]) and re.search(r"[А-ЯЁа-яё]{3}", l["text"])]
    if owner_lines:
        text = owner_lines[0]["text"]
        if len(owner_lines) > 1 and re.search(r"лизингополучател", text, re.I) and not re.search(r"ООО|АО|ИП", text.upper()):
            text = text + " " + owner_lines[1]["text"]
        text = re.sub(r"(?i)^\s*лизингополучатель\s*[-–—:]?\s*", "", text).strip()
        # «000 "ТРАНСАВТО"», «00О»: нули вместо букв формы собственности
        text = re.sub(r'^[0OО]{3}(?=\s*["«“])', "ООО", text)
        f["owner"] = field(text, min(owner_lines[:2], key=lambda l: l["conf"]))
    else:
        f["owner"] = field(None, None)
    notes = fix_date_twins(" ".join(l["text"] for l in lines if stop is None or l["cy"] > stop["cy"]))
    notes_up = notes.upper().translate(LAT2CYR)
    m = re.search(r"ЛИЗИНГОДАТЕЛ[ЬЯ]\s+(.+?)\s+(?:ПО\s|$)", notes_up)
    lessor_line = next((l for l in lines if "ЛИЗИНГОДАТЕЛ" in l["text"].upper()), None)
    f["lessor"] = field(m.group(1).strip(' ,."') if m else None, lessor_line)
    m = re.search(r"УЧ[ЕЁ]Т\s*Д[ОO]?\s*[:.]?\s*(\d{2}[.,]\d{2}[.,]\d{4})", re.sub(r"\s+", " ", notes_up))
    till_line = next((l for l in lines if re.search(r"\d{2}[.,]\d{2}[.,]\d{4}", fix_date_twins(l["text"])) and stop is not None
                      and l["cy"] > stop["cy"] and "ВЫДАЧИ" not in l["text"].upper()), None)
    f["temp_till"] = field(m.group(1).replace(",", ".") if m else None, till_line if m else None)
    n = sts_number(lines)
    f["sts"] = {"value": n["value"], "conf": n["conf"], "line": n["line"]} if n else field(None, None)
    return f, n


# ---------------- доверенность (форма М-2) ----------------

MONTHS = {"январ": 1, "феврал": 2, "март": 3, "апрел": 4, "ма": 5, "июн": 6, "июл": 7, "август": 8,
          "сентябр": 9, "октябр": 10, "ноябр": 11, "декабр": 12}


def any_date(t):
    """«19.10.2026» или «19 октября 2026 г.» → «19.10.2026»."""
    m = DATE_RE.search(t or "")
    if m:
        return f"{m.group(1)}.{m.group(2)}.{m.group(3)}"
    m = re.search(r"(\d{1,2})\s+([а-яё]+)\s+(\d{4})", (t or "").lower())
    if m:
        mon = next((n for k, n in sorted(MONTHS.items(), key=lambda kv: -len(kv[0])) if m.group(2).startswith(k)), None)
        if mon:
            return f"{int(m.group(1)):02d}.{mon:02d}.{m.group(3)}"
    return None


def row_text(lines, label):
    """Подпись и всё, что правее неё в той же строке документа, одной строкой."""
    return " ".join([label["text"]] + [l["text"] for l in same_row_right(lines, label)])


FIO_MIXED = re.compile(r"[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+")


def extract_poa(lines):
    f = {}
    lab = find_line(lines, "ДОВЕРЕННОСТЬ№") or find_line(lines, "ДОВЕРЕННОСТЬ")
    num = None
    if lab:
        m = re.search(r"№\s*(\S+)", row_text(lines, lab))
        num = m.group(1) if m else None
        if not num:
            r = right_of(lines, lab)
            num = r["text"].strip() if r and re.fullmatch(r"[\w/-]{1,12}", r["text"].strip()) else None
    f["number"] = field(num, lab)
    # «Дата выдачи» доверенности — первая такая подпись ниже заголовка (вторая — дата выдачи паспорта)
    dlab = next((l for l in lines if "дата выдачи" in l["text"].lower() and (lab is None or l["cy"] > lab["cy"])), None)
    f["issued"] = field(any_date(row_text(lines, dlab)) if dlab else None, dlab)
    vlab = next((l for l in lines if "действительн" in l["text"].lower()), None)
    f["valid_till"] = field(any_date(row_text(lines, vlab)) if vlab else None, vlab)
    org = next((l for l in lines if re.search(r"(ООО|ОАО|ЗАО|АО|ИП)\s*.+ИНН\s*\d{10}", l["text"].upper())), None)
    if org:
        m = re.match(r"\s*(.+?)\s*,\s*ИНН\s*(\d{10,12})", org["text"], re.I)
        f["issuer"] = field(m.group(1).strip() if m else None, org)
        f["issuer_inn"] = field(m.group(2) if m else None, org)
    else:
        f["issuer"] = field(None, None)
        f["issuer_inn"] = field(None, None)
    glab = find_line(lines, "ДОВЕРЕННОСТЬВЫДАНА")
    rep_line = None
    if glab:
        rep_line = next((l for l in same_row_right(lines, glab) if FIO_MIXED.search(l["text"])), None)
        if not rep_line:
            rep_line = value_near(lines, glab, lambda t: bool(FIO_MIXED.search(t)), below=1.5)
    if not rep_line:
        rep_line = next((l for l in lines if FIO_MIXED.fullmatch(l["text"].strip())), None)
    rep_val = FIO_MIXED.search(rep_line["text"]).group(0) if rep_line else None
    f["representative"] = ru_field(rep_line, rep_val) if rep_line else field(None, None)
    plab = next((l for l in lines if "серия" in l["text"].lower()), None)
    pas = None
    if plab:
        m = re.search(r"(\d{2})\s?(\d{2}).*?(\d{6})", row_text(lines, plab))
        pas = f"{m.group(1)} {m.group(2)} {m.group(3)}" if m else None
    f["passport"] = field(pas, plab)
    # корешок доверенности (таблица вверху): номер и даты — независимое подтверждение
    stub = [l["text"].strip() for l in lines if lab is None or l["cy"] < lab["cy"]]
    return f, stub


WORD_MONTHS = {"ЯНВАР": 1, "ФЕВРАЛ": 2, "МАРТ": 3, "АПРЕЛ": 4, "МА": 5, "ИЮН": 6, "ИЮЛ": 7, "АВГУСТ": 8,
          "СЕНТЯБР": 9, "ОКТЯБР": 10, "НОЯБР": 11, "ДЕКАБР": 12}
WORD_DATE_RE = re.compile(r"(\d{1,2})\s*(ЯНВАР|ФЕВРАЛ|МАРТ|АПРЕЛ|МА[ЯЙ]|ИЮН|ИЮЛ|АВГУСТ|СЕНТЯБР|ОКТЯБР|НОЯБР|ДЕКАБР)[А-Я]*\.?\s*(\d{4})")
# подписи штампа старого образца: «Рег-н:», «Пункт:», «Улица:», «Дом:», «Корп:», «Кв:»
ADDR_LABEL_RE = re.compile(r"(Р[ЕE][ГR][\s.-]*Н|ПУНКТ|УЛИЦА|ДОМ|КОРП(?:УС)?|КВ(?:АРТИРА)?)\s*[.:]+")
ADDR_PREFIX = {"УЛИЦА": "УЛ. ", "ДОМ": "Д. ", "КОРП": "КОРП. ", "КВ": "КВ. "}


def rows_of(lines):
    """Фрагменты одного ряда (детекция режет «25 | Июля 2001г.») — слева направо."""
    rows = []
    for l in sorted(lines, key=lambda l: l["cy"]):
        row = next((r for r in rows if abs(r[0]["cy"] - l["cy"]) < 0.5 * min(r[0]["h"], l["h"])), None)
        if row is None:
            rows.append([l])
        else:
            row.append(l)
    return [sorted(r, key=lambda l: l["x0"]) for r in rows]


def word_date(text):
    """«25 Июля 2001г.» → «25.07.2001»."""
    m = WORD_DATE_RE.search(cyr(text))
    if not m:
        return None
    month = next(n for k, n in WORD_MONTHS.items() if m.group(2).startswith(k))
    value = f"{int(m.group(1)):02d}.{month:02d}.{m.group(3)}"
    return value if parse_date(value) else None


def join_rows(rows):
    """Строки адреса в одну: после «,» или сокращения с точкой («УЛ.») — пробел, иначе запятая
    (раньше выходило «КРАЙ,, Р-Н» и «УЛ., ЛЕНИНА»)."""
    out = ""
    for r in rows:
        r = cyr(r).strip()
        out = r if not out else out + (" " if re.search(r"[,.]$", out) else ", ") + r
    return out


def fix_numbers(value):
    """«Д. 1О» → «Д. 10»: буква О рядом с цифрами — ноль."""
    return re.sub(r"(?<=\d)[ОO]|[ОO](?=\d)", "0", value) if value else value


# чистка адреса штампа (ажурный фон «РОССИЯ» мешает нейросети): скобка/точка с запятой вместо
# точки после сокращения, «ОБП»/«ОБВ» → «ОБЛ.» (Л на ажуре читается как П/В)
ADDR_PUNCT = re.compile(r"\b(Г|ГОР|С|П|ПОС|ДЕР|УЛ|КВ|Д|КОРП|ПР|ПЕР|ПРОЕЗД|РАЙОН|Р-Н)\)")
ADDR_OBL = re.compile(r"\bОБ[ПВФГДКТ]\b\.?")
ADDR_OBL_DOT = re.compile(r"\bОБЛ\b(?!\.)")


def fix_addr_punct(value):
    """Пунктуация адреса: «ЗАВЕРТЯЕВА; Д. 23, КВ) 98» → «…, Д. 23, КВ. 98», «ОБП» → «ОБЛ."."""
    if not value:
        return value
    v = value.replace(";", ",").replace(" ,", ",")
    v = ADDR_PUNCT.sub(r"\1.", v)
    v = ADDR_OBL.sub("ОБЛ.", v)
    v = ADDR_OBL_DOT.sub("ОБЛ.", v)
    v = re.sub(r"\.{2,}", ".", v)   # «УЛ..» — точка добавлена дважды (fix_letters + ABBR_NO_DOT)
    v = re.sub(r"\s{2,}", " ", v)
    return v.strip(" ,")


def reg_series_number(path, lines):
    """Серия и номер на странице регистрации — для сверки со страницей с фото:
    напечатаны внизу страницы («95 02 456987»), на полях вертикально или пробиты перфорацией (10 цифр)."""
    for row in rows_of(lines):
        text = " ".join(l["text"] for l in row)
        m = SERIES_NUMBER_RE.search(text) or re.fullmatch(r"\s*(\d{2})(\d{2})(\d{6})\s*", re.sub(r"\s", "", text))
        if m and not DATE_RE.search(text):
            return field(f"{m.group(1)} {m.group(2)} {m.group(3)}", min(row, key=lambda l: l["conf"]))
    copies = read_margin_number(path, lines)
    if copies:
        top = max(copies, key=lambda c: c["conf"])
        return {"value": f"{top['series'][:2]} {top['series'][2:]} {top['number']}", "conf": top["conf"], "line": None}
    return field(None, None)


def labeled_address(text):
    """Адрес из штампа с подписями → «СВЕРДЛОВСКАЯ ОБЛ., ГОР. ЕКАТЕРИНБУРГ, УЛ. …, Д. …, КВ. …»;
    None — подписей меньше двух (обычный штамп, адрес строками)."""
    parts = ADDR_LABEL_RE.split(cyr(text))
    if len(parts) < 5:
        return None
    out = []
    for label, value in zip(parts[1::2], parts[2::2]):
        value = re.sub(r"\s+", " ", value).strip(" ,;")
        if not value or value in ("-", "–"):
            continue
        key = next((k for k in ADDR_PREFIX if label.startswith(k)), None)
        out.append(ADDR_PREFIX[key] + value if key else fix_settlement(value))
    return ", ".join(out) or None


DEPARTMENT_WORDS = ("ОТДЕЛ", "ОТДЕЛОМ", "ОТДЕЛЕНИЕ", "ОТДЕЛЕНИЕМ", "ВОПРОСАМ", "МИГРАЦИИ", "ПАСПОРТНЫЙ", "ПАСПОРТНО-ВИЗОВОЙ")


def is_department(text):
    """Строка подразделения под адресом штампа — конец адреса. Узнаётся и прочитанная с ошибками:
    «ОТАЕН ПО ВОПРОСАН ЕИГРАЦИИ», «УФМС», «ОМВД»."""
    t = cyr(text).replace("Ё", "Е")
    if re.search(r"ОТДЕ|МИГРАЦ|УФМС|[ОУ]?МВД|ОВД|ПВС", t):
        return True
    return any(_lev(tok, w) <= (1 if len(w) <= 6 else 2) for tok in re.findall(r"[А-Я-]{5,}", t) for w in DEPARTMENT_WORDS
               if abs(len(tok) - len(w)) <= 1)


def extract_registration(lines):
    f = {}
    head = next((l for l in lines if "ЗАРЕГИСТРИРОВАН" in l["text"].upper()), None)
    d = next((l for l in lines if parse_date(l["text"]) and (head is None or l["cy"] > head["cy"])), None)
    f["reg_date"] = field(DATE_RE.search(d["text"]).group(0) if d else None, d)
    if not d:
        # штамп старого образца: дата словами, иногда разрезана на части одного ряда
        for row in rows_of(lines):
            if head and row[0]["cy"] <= head["cy"]:
                continue
            value = word_date(" ".join(l["text"] for l in row))
            if value:
                d = max(row, key=lambda l: l["cy"])
                f["reg_date"] = field(value, min(row, key=lambda l: l["conf"]))
                break
    stop = next((l for l in lines if is_department(l["text"]) and (d is None or l["cy"] > d["cy"])), None)
    # обрывки из 2 знаков не выбрасываем: «КВ.» и «98» детекция на изношенном штампе режет
    # на такие куски (боевой тест: строка «КВ. 98» читается как «YJ» + «98» + «KB)»); шум — односимвольный
    addr = [l for l in lines if d and l["cy"] > d["cy"] + 0.5 * d["h"] and (stop is None or l["cy"] < stop["cy"] - 0.5 * stop["h"])
            and len(re.sub(r"[^А-ЯA-Zа-яa-z0-9]", "", l["text"])) >= 2]
    if addr:
        worst = min(addr, key=lambda l: l["conf"])
        rows = [" ".join(lex_fix(cyr(l["text"]), l, "address") for l in r) for r in rows_of(addr)]
        value = fix_addr_punct(fix_letters(fix_numbers(labeled_address(" ".join(rows)) or join_rows(rows))))
        f["address"] = field(ABBR_NO_DOT.sub(lambda m: f"{m.group(1)}{m.group(2)}. ", value), worst)
    else:
        f["address"] = field(None, None)
    v = next((l for l in lines if re.fullmatch(r"\d{3}-\d{3}", l["text"].strip())), None)
    f["dept"] = field(v["text"].strip() if v else None, v)
    return f


# ---------------- итог в формате платформы ----------------

REQUIRED_KEYS = {
    "passport": ("surname", "name", "birth_date", "series_number"),
    "driver_license": ("surname", "name", "birth_date", "number"),
    "vehicle_registration": ("plate", "vin"),
}


# вырезанный документ увеличиваем до PREP_TARGET px по большей стороне, но не больше чем в PREP_MAX_SCALE раз
PREP_TARGET = int(os.environ.get("OCR_PREP_TARGET", "1500"))
PREP_MAX_SCALE = float(os.environ.get("OCR_PREP_MAX_SCALE", "3"))


def document_box(img):
    """Документ на белом листе (скан А4 с СТС на 20–35 % ширины): рамка содержимого или None.
    «Не фон» — заметный цвет или тёмное; от крупнейшего пятна рамка растёт на соседние пятна,
    дальние (пыль, разводы сканера) не входят. Фото с фоном (стол, шторы) не режем: там
    содержимое занимает почти весь кадр."""
    h, w = img.shape[:2]
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    mask = ((hsv[..., 1] > 35) | (hsv[..., 2] < 190)).astype(np.uint8) * 255
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((21, 21), np.uint8))
    n, _, stats, _ = cv2.connectedComponentsWithStats(mask)
    blobs = [tuple(int(v) for v in stats[i][:4]) for i in range(1, n) if stats[i][4] > 0.0005 * w * h]
    if not blobs:
        return None
    x0, y0, bw, bh = max(blobs, key=lambda b: b[2] * b[3])
    x1, y1 = x0 + bw, y0 + bh
    gap = int(0.04 * max(w, h))
    grown = True
    while grown:
        grown = False
        for bx, by, bbw, bbh in blobs:
            if bx < x1 + gap and bx + bbw > x0 - gap and by < y1 + gap and by + bbh > y0 - gap \
                    and (bx < x0 or by < y0 or bx + bbw > x1 or by + bbh > y1):
                x0, y0, x1, y1 = min(x0, bx), min(y0, by), max(x1, bx + bbw), max(y1, by + bbh)
                grown = True
    if (x1 - x0) * (y1 - y0) > 0.5 * w * h or min(x1 - x0, y1 - y0) < 120:
        return None
    pad = int(0.03 * max(x1 - x0, y1 - y0))
    return max(0, x0 - pad), max(0, y0 - pad), min(w, x1 + pad), min(h, y1 + pad)


def prepare(path, crop=True):
    """Подготовка кадра: маленький документ на листе вырезается и увеличивается (до PREP_TARGET px),
    мелкий кадр целиком — вдвое: подписи высотой 10–16 px иначе не читаются.
    Возвращает (путь, вырезан ли документ)."""
    img = cv2.imdecode(np.fromfile(str(path), np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        return path, False
    box = document_box(img) if crop else None
    work = img[box[1]:box[3], box[0]:box[2]] if box else img
    side = max(work.shape[:2])
    if box:
        k = min(PREP_MAX_SCALE, PREP_TARGET / side)
    else:
        k = 2.0 if side < UPSCALE_BELOW else 1.0   # мелкий кадр целиком — вдвое, как раньше
    if not box and k <= 1.0:
        return path, False
    if k > 1.0:
        work = cv2.resize(work, None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC)
    out = path.with_name(path.stem + ("_crop.png" if box else "_prep.png"))   # без потерь: JPEG размывает подписи
    cv2.imencode(".png", work)[1].tofile(str(out))
    return out, bool(box)


def scaled(path, k, suffix):
    """Копия фото, увеличенная в k раз (None — получилось бы больше 4000 px по стороне)."""
    img = cv2.imdecode(np.fromfile(str(path), np.uint8), cv2.IMREAD_COLOR)
    if img is None or max(img.shape[:2]) * k > 4000:
        return None
    big = cv2.resize(img, None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC)
    out = path.with_name(path.stem + suffix + ".png")   # без потерь, как и prepare()
    cv2.imencode(".png", big)[1].tofile(str(out))
    return out


def _incomplete(out):
    """Документ не узнан или не дочитаны его главные поля."""
    f, t = out["fields"], out["docType"]
    need = {"PASSPORT_PHOTO": ("Фамилия", "Имя", "Дата рождения", "Серия и номер", "Дата выдачи", "Код подразделения"),
            "PASSPORT_REG": ("Дата регистрации", "Адрес регистрации"),
            "POA": ("Номер доверенности", "Дата выдачи")}
    if t == "UNKNOWN":
        return True
    if t == "STS":
        keys = ("Номер СТС", "Владелец") if out.get("side") == "back" else ("Госномер", "Номер СТС", "Марка")
    else:
        keys = need.get(t, ())
    return any(not f.get(k) for k in keys)


def _needs_upscale(out):
    """Документ не узнан или главные поля не дочитаны — стоит ещё проход по увеличенному кадру."""
    f, c = out["fields"], out["confidences"]
    t = out["docType"]
    if t == "UNKNOWN":
        return True
    if t == "PASSPORT_PHOTO":
        keys = ("Фамилия", "Имя", "Отчество", "Дата рождения", "Серия и номер", "Дата выдачи", "Код подразделения")
        # повтор дешёвый (строки читаются с кадра покрупнее), а поля нужные для сверки с заявкой
        return any(not f.get(k) for k in keys + (("Место рождения", "Кем выдан") if LOW_MEMORY else ()))
    if t == "PASSPORT_REG":
        # «5» вместо адреса — от адреса прочитан обрывок: тоже повтор
        addr = f.get("Адрес регистрации") or ""
        return len(re.findall(r"[А-ЯЁA-Z]", addr.upper())) < 8 or c.get("Адрес регистрации", 0) < 0.6
    if t == "STS" and out.get("side") == "front":
        return not f.get("Госномер") or not f.get("Номер СТС")
    return False


def analyze(path, upscale_retry=True):
    """Фото → {quality, sharpness, docType, side, fields, confidences, confirmations}.
    Поля называются так же, как в DOC_FIELDS (src/lib/verify.ts).

    Task 86 — одна сильная модель на все операции платформы («Проверить» единственная
    кнопка). Недочитанные места добирают повторные проходы по кадру, все — той же моделью:
    целый лист (если документ вырезан с полей), штамп прописки крупным планом (stamp_pass),
    кадр ×1,5 и разворот на 180°."""
    from pathlib import Path
    path = Path(path)
    sharp = sharpness(path)
    quality = int(round(min(100.0, 60.0 * sharp / SHARPNESS_MIN)))
    work, cropped = prepare(path)
    try:
        lines, work, turns = read_upright(work, path)
        out = _analyze_lines(work, lines, quality, sharp)
        # документ вырезан с листа, но не узнан или главные поля не дочитаны: читаем и исходный кадр
        # и добираем пустое — результат по вырезке чувствителен к масштабу (×2,39 и ×2,392 — разное)
        if cropped and _incomplete(out):
            whole, _ = prepare(path, crop=False)
            if turns:
                rotated = turned_copy(whole, turns, "_t")
                if whole != path:
                    try:
                        os.unlink(whole)
                    except OSError:
                        pass
                whole = rotated
            try:
                out = _fill_gaps(out, _analyze_lines(whole, read_lines(whole), quality, sharp), margin=0.1)
            finally:
                if whole != path:
                    try:
                        os.unlink(whole)
                    except OSError:
                        pass
        # штамп прописки: его строки мелкие на фоне листа — детекция на кадре до DET_MAX_SIDE
        # их теряет (боевой тест: из адреса остался обрывок «КВ98»). Вырезка штампа в нативном
        # разрешении читает адрес целиком и стоит несколько секунд
        if out["docType"] == "PASSPORT_REG" and _stamp_incomplete(out):
            stamp_pass(work, lines, out, quality, sharp)
        # фото с телефона: документ занимает часть кадра, шрифт мелкий, защитный фон —
        # документ не узнан или поля не дочитаны → проход по кадру, увеличенному в 1,5 раза
        # (на странице регистрации ошибок в адресе стало 5 из 52 знаков вместо 20)
        if upscale_retry and _needs_upscale(out):
            big = scaled(work, 1.5, "_x15")
            if big:
                try:
                    out = _fill_gaps(out, _analyze_lines(big, read_lines(big), quality, sharp), margin=0.1)
                finally:
                    try:
                        os.unlink(big)
                    except OSError:
                        pass
        # документ не узнан — возможно, снят вверх ногами (штамп прописки): ещё проход по развёрнутому кадру
        if upscale_retry and out["docType"] == "UNKNOWN":
            img = cv2.imdecode(np.fromfile(str(work), np.uint8), cv2.IMREAD_COLOR)
            if img is not None:
                flipped = work.with_name(work.stem + "_r180.png")
                cv2.imencode(".png", cv2.rotate(img, cv2.ROTATE_180))[1].tofile(str(flipped))
                try:
                    second = _analyze_lines(flipped, read_lines(flipped), quality, sharp)
                    if second["docType"] != "UNKNOWN":
                        out = second
                finally:
                    try:
                        os.unlink(flipped)
                    except OSError:
                        pass
    finally:
        if work != path:
            try:
                os.unlink(work)
            except OSError:
                pass
    return out


def _stamp_incomplete(out):
    """Штамп прописки дочитан не полностью — нужен повтор крупным планом.
    Адрес короче 12 букв (боевой тест: обрывок «КВ98» — 2 буквы; полный адрес — от 20)
    или неуверенный, нет даты или кода подразделения."""
    f, c = out["fields"], out["confidences"]
    addr = f.get("Адрес регистрации") or ""
    if len(re.findall(r"[А-ЯЁA-Z]", addr.upper())) < 12 or c.get("Адрес регистрации", 0) < 0.75:
        return True
    return not f.get("Дата регистрации") or not f.get("Код подразделения")


def stamp_box(lines):
    """Рамка штампа «МЕСТО ЖИТЕЛЬСТВА» в координатах кадра: объединённый прямоугольник опорных
    строк (заголовок «ЗАРЕГИСТРИРОВАН», дата регистрации, код подразделения, «КВ.») с полями.
    None — опорных строк нет: детекция не нашла штамп вовсе."""
    head = next((l for l in lines if "ЗАРЕГИСТРИРОВАН" in cyr(l["text"])), None)
    anchors = [head] if head else []
    d = next((l for l in lines if parse_date(l["text"]) and (head is None or l["cy"] > head["cy"])), None)
    if d:
        anchors.append(d)
    code = next((l for l in lines if re.fullmatch(r"\d{3}-\d{3}", l["text"].strip())), None)
    if code:
        anchors.append(code)
    anchors += [l for l in lines if re.search(r"\bКВ", cyr(l["text"])) and re.search(r"\d", l["text"])][:2]
    if not anchors:
        return None
    x0 = min(l["x0"] for l in anchors)
    x1 = max(l["x1"] for l in anchors)
    y0 = min(l["y0"] for l in anchors)
    y1 = max(l["y1"] for l in anchors)
    h = max(l["h"] for l in anchors)
    w = max(x1 - x0, 12 * h)
    # поля: в стороны — больше половины ширины штампа (адрес длиннее опорных строк); сверху —
    # 3 высоты строки (заголовок «МЕСТО ЖИТЕЛЬСТВА»); снизу — много (14 высот): якорей мало,
    # а под адресом ещё «КВ.», наименование подразделения и код «550-007» — все нужны в кадре.
    # Лишнее в кадре не мешает (подпись, фон), недостающее — теряет поля.
    return max(0.0, x0 - 0.7 * w), max(0.0, y0 - 3 * h), x1 + 0.7 * w, y1 + 14 * h


def stamp_pass(work, lines, out, quality, sharp):
    """Повторное чтение штампа прописки крупным планом (Task 86).
    Страница регистрации на листе А4 или в обложке: строки штампа занимают 2–4 % высоты кадра,
    детекция (кадр ограничен DET_MAX_SIDE ради памяти) находит только обрывки. Вырезка штампа
    в нативном разрешении, увеличенная до STAMP_TARGET px, даёт строкам 3–4-кратный размер —
    адрес читается целиком; кадр маленький, памяти — копейки, времени — несколько секунд."""
    box = stamp_box(lines)
    if not box:
        return
    img = cv2.imdecode(np.fromfile(str(work), np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        return
    h, w = img.shape[:2]
    x0, y0, x1, y1 = box
    x0, y0, x1, y1 = max(0, int(x0)), max(0, int(y0)), min(w, int(x1)), min(h, int(y1))
    if x1 - x0 < 80 or y1 - y0 < 60:
        return
    crop = img[y0:y1, x0:x1]
    side = max(crop.shape[:2])
    k = max(1.0, min(PREP_MAX_SCALE, STAMP_TARGET / side))
    if k > 1.0:
        crop = cv2.resize(crop, None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC)
    tmp = work.with_name(work.stem + "_stamp.png")
    cv2.imencode(".png", crop)[1].tofile(str(tmp))
    try:
        second = _analyze_lines(tmp, read_lines(tmp), quality, sharp)
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass
    _merge_stamp(out, second)


def _merge_stamp(main, extra):
    """Штамповый проход читает штамп с большим разрешением — его адрес полнее whole-page:
    замещаем адрес, если тот длиннее (conf строки-обрывка вроде «YI» не в счёт — он тянет
    вниз уверенность всей строки, боевой тест Task 86); пустые дату и код добираем.
    Страница регистрации — адрес один, сверять стороны не нужно."""
    if extra["docType"] != "PASSPORT_REG":
        return
    letters = lambda s: len(re.findall(r"[А-ЯЁA-Z]", (s or "").upper()))
    addr = (extra["fields"].get("Адрес регистрации") or "").strip()
    cur = (main["fields"].get("Адрес регистрации") or "").strip()
    if addr and extra["confidences"].get("Адрес регистрации", 0) >= 0.2 and letters(addr) > letters(cur):
        main.get("confirmations", {}).pop("Адрес регистрации", None)
        main["fields"]["Адрес регистрации"] = addr
        main["confidences"]["Адрес регистрации"] = extra["confidences"].get("Адрес регистрации", 0)
    for k in ("Дата регистрации", "Код подразделения", "Серия и номер"):
        v = (extra["fields"].get(k) or "").strip()
        if v and not main["fields"].get(k):
            main["fields"][k] = v
            main["confidences"][k] = extra["confidences"].get(k, 0)


def _fill_gaps(main, extra, margin=None):
    """Пустые поля основного прохода — из второго прохода того же документа (той же стороны).
    margin — заменять и заполненные поля, если второй проход увереннее хотя бы на столько
    И не короче по содержанию: уверенный обрывок («…Д. 23» без «КВ. 98») не должен затирать
    более полный адрес менее уверенного прохода по штампу крупным планом (боевой тест Task 86)."""
    if main["docType"] == "UNKNOWN":
        return extra if extra["docType"] != "UNKNOWN" else main
    if extra["docType"] != main["docType"] or extra.get("side") != main.get("side"):
        return main
    letters = lambda s: len(re.findall(r"[А-ЯЁA-Z0-9]", (s or "").upper()))
    for k, v in extra["fields"].items():
        cur = main["fields"].get(k) or ""
        better = margin is not None and extra["confidences"].get(k, 0) > main["confidences"].get(k, 0) + margin \
            and letters(v) >= letters(cur) - 1
        if v and (not cur or better):
            main.get("confirmations", {}).pop(k, None)
            main["fields"][k] = v
            main["confidences"][k] = extra["confidences"].get(k, 0)
            if k in extra.get("confirmations", {}):
                main.setdefault("confirmations", {})[k] = extra["confirmations"][k]
    return main


def _filled(out):
    return sum(1 for v in out["fields"].values() if v)


def _analyze_lines(path, lines, quality, sharp):
    dtype = doc_type(lines)
    out = {"quality": quality, "sharpness": round(sharp, 1), "docType": PLATFORM_TYPE[dtype], "side": "front",
           "fields": {}, "confidences": {}, "confirmations": {}}

    def put(label, f):
        out["fields"][label] = f["value"] or ""
        out["confidences"][label] = float(f["conf"] or 0.0)

    def confirm(label, text):
        out["confirmations"].setdefault(label, []).append(text)

    if dtype == "passport":
        f, copies = extract_passport(path, lines)
        mrz = read_mrz(lines)
        if mrz:
            labels = {"surname": "Фамилия", "name": "Имя", "patronymic": "Отчество", "birth_date": "Дата рождения",
                      "series_number": "Серия и номер", "issue_date": "Дата выдачи", "dept": "Код подразделения"}
            same = lambda a, b: re.sub(r"\W", "", cyr(a).replace("Ё", "Е")) == re.sub(r"\W", "", cyr(b).replace("Ё", "Е"))
            # строка с ФИО разобрана целиком: «<» не прочитан буквой (имя не склеилось с отчеством)
            names_ok = mrz.get("genuine") and bool(mrz.get("name", (None,))[0]) and (
                bool(mrz.get("patronymic", (None,))[0]) or not f["patronymic"]["value"])
            for key, label in labels.items():
                value, checked, conf = mrz.get(key, (None, False, 0))
                cur = f[key]
                raw = mrz.get(key + "_raw")
                if raw and cur["value"]:
                    # ФИО: бланк сверяется с МЧЗ (таблицы МВД и ICAO); одна неверная буква исправляется
                    fixed = mrz_correct(cur["value"], raw, kind=key)
                    if fixed:
                        word, changed = fixed
                        f[key] = {"value": word, "conf": round(max(conf, cur["conf"] or 0), 3), "line": cur["line"]}
                        confirm(label, "исправлено по машиночитаемой строке" if changed else "совпало с машиночитаемой строкой")
                        continue
                if not value:
                    continue
                if cur["value"] and same(cur["value"], value):
                    confirm(label, "совпало с машиночитаемой строкой")
                elif checked:
                    # контрольная цифра сошлась — машиночитаемая строка надёжнее чтения бланка
                    f[key] = {"value": value, "conf": round(max(conf, cur["conf"] or 0), 3), "line": cur["line"]}
                    confirm(label, "контрольная цифра машиночитаемой строки сошлась")
                elif key in ("surname", "name", "patronymic") and names_ok and (not cur["value"] or (cur["conf"] or 0) < conf):
                    # в строке с ФИО контрольных цифр нет: берём её, только если вторая строка подлинная
                    # и бланк прочитан неувереннее; без подтверждения — сверит человек
                    f[key] = {"value": value, "conf": round(0.9 * conf, 3), "line": cur["line"]}
        put("Фамилия", f["surname"])
        put("Имя", f["name"])
        put("Отчество", f["patronymic"])
        put("Дата рождения", f["birth_date"])
        put("Серия и номер", f["series_number"])
        put("Дата выдачи", f["issue_date"])
        put("Код подразделения", reread_code(path, f["dept"]))
        put("Место рождения", f["birth_place"])
        put("Кем выдан", issued_by(lines, f))
        if len(copies) >= 2 and len({(c["series"], c["number"]) for c in copies}) == 1:
            confirm("Серия и номер", f"{len(copies)} копии на полях страницы совпали")

    elif dtype == "driver_license":
        f = extract_driver_license(path, lines)
        sur, nm = f["surname"], f["name"]
        fio = " ".join(x for x in (sur["value"], nm["value"]) if x)
        confs = [x["conf"] for x in (sur, nm) if x["value"] and x["conf"] is not None]
        out["fields"]["ФИО"] = fio
        out["confidences"]["ФИО"] = float(min(confs)) if confs else 0.0
        latin_ok = 0
        for part in (sur, nm):
            lat = latin_below(lines, part["line"]) if part["line"] and part["value"] else None
            if lat and translit(part["value"]) == norm_latin(lat["text"]):
                latin_ok += 1
        if fio and latin_ok == 2:
            confirm("ФИО", "латинская строка ВУ совпала")
        put("Дата рождения", f["birth_date"])
        put("Номер ВУ", f["number"])
        put("Категории", f["categories"])
        put("Дата выдачи", f["issue_date"])
        put("Действует до", f["expiry_date"])
        if f["categories"].get("reread_agrees"):
            confirm("Категории", "повторное чтение крупнее совпало с первым")
        iss, exp = parse_date(f["issue_date"]["value"]), parse_date(f["expiry_date"]["value"])
        if iss and exp and exp == add_years(iss, 10):
            confirm("Действует до", "ровно 10 лет от даты выдачи")
            confirm("Дата выдачи", "срок действия — ровно 10 лет")

    elif dtype == "vehicle_registration":
        f, n = extract_vehicle_registration(lines)
        put("Госномер", f["plate"])
        put("VIN", f["vin"])
        put("Номер СТС", f["sts"])
        put("Марка", f["brand"])
        put("Цвет", f["color"])
        put("Владелец", f["owner"])
        if n and n["count"] >= 2 and n["copies"] == 1:
            confirm("Номер СТС", f"{n['count']} копии номера бланка совпали")

    elif dtype == "vehicle_registration_back":
        out["side"] = "back"
        f, n = extract_sts_back(lines)
        put("Номер СТС", f["sts"])
        put("Владелец", f["owner"])
        put("Лизингодатель", f["lessor"])
        put("Временный учёт до", f["temp_till"])
        if n and n["count"] >= 2 and n["copies"] == 1:
            confirm("Номер СТС", f"{n['count']} копии номера бланка совпали")

    elif dtype == "poa":
        f, stub = extract_poa(lines)
        put("Номер доверенности", f["number"])
        put("Дата выдачи", f["issued"])
        put("Действительна до", f["valid_till"])
        put("Кем выдана (перевозчик)", f["issuer"])
        put("Представитель (ФИО)", f["representative"])
        put("Паспорт представителя", f["passport"])
        put("ИНН организации", f["issuer_inn"])
        stub_text = " ".join(stub)
        if f["number"]["value"] and re.search(rf"(^|\s){re.escape(f['number']['value'])}(\s|$)", stub_text):
            confirm("Номер доверенности", "совпал с корешком доверенности")
        for label, key in (("Дата выдачи", "issued"), ("Действительна до", "valid_till")):
            if f[key]["value"] and f[key]["value"] in stub_text:
                confirm(label, "совпала с корешком доверенности")
        if f["representative"]["value"] and norm_letters(f["representative"]["value"]) in norm_letters(stub_text):
            confirm("Представитель (ФИО)", "совпало с корешком доверенности")
        if f["issuer"]["value"] and norm_letters(f["issuer"]["value"]) in norm_letters(stub_text):
            confirm("Кем выдана (перевозчик)", "совпало с корешком доверенности")

    elif dtype == "passport_registration":
        f = extract_registration(lines)
        put("Дата регистрации", f["reg_date"])
        put("Код подразделения", reread_code(path, f["dept"]))
        put("Адрес регистрации", f["address"])
        # для сверки со страницей с фото: обе страницы должны быть от одного паспорта
        put("Серия и номер", reg_series_number(path, lines))

    return out


def analyze_subprocess(path):
    """Распознавание в отдельном короткоживущем процессе (мало памяти, Task 83): модель
    загружается с нуля, распознаёт ОДИН документ и возвращает память системе.
    Документ дочитан не до конца или не узнан — второй процесс на ступень ниже: на другом
    лимите детекции строки находятся другие (Task 86), пустое добирается слиянием."""
    out = _run_isolated(path)
    if out["docType"] == "UNKNOWN" or _incomplete(out):
        try:
            out = _fill_gaps(out, _run_isolated(path, step=1))
        except RuntimeError:
            pass
    return out


def _run_isolated(path, step=0):
    """analyze() в отдельном короткоживущем процессе (Task 83, стенд 4 ГБ).

    Детекция server_det на большом кадре требует больше памяти, чем есть свободной:
    OOM-killer убивает сервис. Отдельный процесс распознаёт ОДИН документ и возвращает
    память системе. step — ступень лестницы: 0 — максимальный кадр, 1+ — ниже (и память,
    и качество ниже, но строки детекция находит другие). Лестница по свободной памяти
    (замер стенда: сторона 736 не влезает при ~2 ГБ свободных); если ребёнка убило
    (OOM, exit 137) — повторяем со следующей ступенью."""
    import json as _json
    import os as _os
    import subprocess as _sp
    import sys as _sys

    def run_child(limit, area):
        env = dict(_os.environ)
        if limit:
            env["OCR_DET_MAX_SIDE"] = str(limit)
        env["OCR_DET_AREA"] = str(area)
        # __file__ — сам engine.py (sys.argv[0] у сервера — server.py, он займет порт)
        args = [_sys.executable, _os.path.abspath(__file__), str(path)]
        # вывод ребёнка — UTF-8 с обеих сторон: на Windows по умолчанию cp1251, и кириллица
        # в JSON ломала чтение результата (паспорт падал, СТС читался с искажениями)
        env["PYTHONIOENCODING"] = "utf-8"
        return _sp.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=290, env=env)

    avail_mb = available_mb()
    # ступени — (лимит стороны, лимит площади входа детекции): каждое понижение реально
    # снижает память (иначе на маленьких сканах сторона 560 и 448 дают один вход до капа площади).
    # Порог первой ступени понижен до 1500 МБ: свободная память стенда колеблется (~1,9 ГБ),
    # и на границе 1900 лестница теряла большой кадр, читая страницу вслепую (боевой тест Task 86);
    # если ребёнка всё же убьёт OOM — лестница спустится сама
    if avail_mb >= 2600:
        attempts = [(DET_MAX_SIDE, DET_AREA), (736, 0.15), (560, 0.12)]
    elif avail_mb >= 1500:
        attempts = [(560, 0.18), (448, 0.12), (384, 0.09)]
    else:
        attempts = [(448, 0.12), (384, 0.09), (320, 0.07)]
    last_err = "subprocess не вернул результат"
    for limit, area in attempts[max(0, step):]:
        run = run_child(limit, area)
        print(f"[paddle-ocr] ребёнок: ступень {limit}px/{area}MP → rc={run.returncode}, "
              f"{'UNKNOWN' if 'UNKNOWN' in (run.stdout or '') else 'прочитано'}", flush=True)
        if run.returncode in (137, -9):
            # процесс убит системой из-за нехватки памяти — последняя строка stderr тут ни при чём
            last_err = f"нехватка памяти: распознавание остановлено системой (OOM, кадр {limit} px)"
            continue
        if run.returncode == 0:
            lines = [l for l in (run.stdout or "").splitlines() if l.startswith("###JSON###")]
            if lines:
                return _json.loads(lines[-1][len("###JSON###"):])
        if run.stderr:
            last_err = run.stderr.strip().splitlines()[-1][:300]
    raise RuntimeError(last_err)


if __name__ == "__main__":
    # CLI для analyze_subprocess: python3 engine.py <image>
    import json as _json
    import sys as _sys
    # ребёнок расходуемый (OOM → родитель повторит с меньшим кадром): при нехватке памяти
    # система должна убить ЕГО, а не платформу. oom_score_adj выше — жертва первее
    # (у next-server анонимной памяти больше, без этого он погибал первым — боевой тест)
    try:
        with open("/proc/self/oom_score_adj", "w") as _fh:
            _fh.write("800")
    except OSError:
        pass
    _res = analyze(_sys.argv[1])
    _out = {k: _res.get(k) for k in ("quality", "sharpness", "docType", "side", "fields", "confidences", "confirmations")}
    print("###JSON###" + _json.dumps(_out, ensure_ascii=False))
