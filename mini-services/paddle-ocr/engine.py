"""Чтение документов перевозчика: PaddleOCR + шаблоны полей.

PaddleOCR (три нейросети: поиск строк, ориентация строк, чтение) только читает текст.
Дальше обычный код: тип документа по ключевым словам, поля по шаблону и независимые
подтверждения, которые видны на самом документе (копии номера на полях паспорта,
латинская строка ВУ, повторное чтение категорий, срок ВУ = выдача + 10 лет).

Правила проверки (сверка с заявкой, пороги, статусы) — на платформе (src/lib/verify.ts):
сервис получает только фото и ничего не знает о заявке.

Поддерживаются: паспорт РФ (страница с фото; серия и номер — с полей страницы),
страница регистрации, водительское удостоверение, СТС (лицевая сторона и оборот),
доверенность по форме М-2.

Скорость: сначала быстрая модель поиска текста (mobile), и только если документ не узнан
или не хватает ключевых полей — второй проход точной (server). На ноутбуке без видеокарты
это 6–17 с на документ вместо 30–90 с.
"""
import os
import gc
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
SERIES_NUMBER_RE = re.compile(r"(\d{2}) ?(\d{2}) +(\d{6})")

# вид документа по шаблону → тип документа платформы
PLATFORM_TYPE = {"passport": "PASSPORT_PHOTO", "passport_registration": "PASSPORT_REG",
                 "driver_license": "LICENSE", "vehicle_registration": "STS", "vehicle_registration_back": "STS",
                 "poa": "POA", "unknown": "UNKNOWN"}
SUPPORTED = {"PASSPORT_PHOTO", "PASSPORT_REG", "LICENSE", "STS", "POA"}

# модели: быстрая для первого прохода, точная — для повторного (переопределяются переменными окружения)
FAST_DET = os.environ.get("OCR_DET_FAST", "PP-OCRv5_mobile_det")
ACCURATE_DET = os.environ.get("OCR_DET_ACCURATE", "PP-OCRv5_server_det")
REC_MODEL = os.environ.get("OCR_REC_MODEL", "eslav_PP-OCRv5_mobile_rec")
UPSCALE_BELOW = int(os.environ.get("OCR_UPSCALE_BELOW", "1300"))   # мелкие сканы увеличиваем вдвое
# точная модель ищет строки на кадре не больше этого размера: на фото паспорта 1500×2000 — 38 с вместо 70,
# поля те же (сами строки читаются с исходного кадра)
ACCURATE_MAX_SIDE = int(os.environ.get("OCR_ACCURATE_MAX_SIDE", "1600"))


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


# Режим экономии памяти (Task 83, стенд 4 ГБ): одна нейросеть в памяти, документ — в отдельном
# процессе, мелкий кадр для точной модели. При запасе памяти обе модели держатся тёплыми.
# OCR_LOW_MEMORY=1/0 — включить или выключить явно; иначе по свободной памяти при старте.
_low = os.environ.get("OCR_LOW_MEMORY", "").strip()
LOW_MEMORY = _low == "1" if _low in ("0", "1") else available_mb() < 6000
MARGIN_MAX_SIDE = 2000   # полоса с номером на полях паспорта (см. read_margin_number)


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
_mode = "fast"

# признаки известных документов: если на фото нет ни одного, точный повторный проход не нужен —
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


def get_ocr(mode=None):
    """mode: fast — быстрая модель поиска текста, accurate — точная (медленнее в 3–5 раз).

    Экономия памяти на стенде 4 ГБ (Task 83): в памяти держим ТОЛЬКО одну нейросеть —
    при загрузке другой другая выгружается (server_det + mobile_det вместе ~3.2 ГБ → OOM-killer;
    по одной ~0.6–1.2 ГБ). Переключение режима перезагружает модель (~10–20 с)."""
    mode = mode or _mode
    if mode not in _ocr:
        from paddleocr import PaddleOCR
        if RUSSIAN_ONLY:
            _hook_decoder()
        # мало памяти — выгружаем другую нейросеть, если она загружена
        for other in [m for m in _ocr if m != mode and LOW_MEMORY]:
            del _ocr[other]
            gc.collect()
        # enable_mkldnn=False: в PaddlePaddle 3.3 ускоритель oneDNN падает на этих моделях
        _ocr[mode] = PaddleOCR(
            text_detection_model_name=FAST_DET if mode == "fast" else ACCURATE_DET,
            text_recognition_model_name=REC_MODEL,
            use_doc_orientation_classify=False, use_doc_unwarping=False,
            use_textline_orientation=True, enable_mkldnn=False)
    return _ocr[mode]


def read_lines(path):
    ocr = get_ocr()
    _PROBS.clear()
    limit = {"text_det_limit_side_len": ACCURATE_MAX_SIDE, "text_det_limit_type": "max"} if _mode == "accurate" else {}
    res = ocr.predict(str(path), **limit)[0]
    decoded = [(*greedy(p[b], chars), p[b], chars) for p, chars in _PROBS for b in range(p.shape[0])]
    lines = []
    for text, score, poly in zip(res["rec_texts"], res["rec_scores"], res["rec_polys"]):
        p = np.array(poly, dtype=float)
        x0, y0 = p.min(axis=0)
        x1, y1 = p.max(axis=0)
        hit = next((d for d in decoded if d[0] == text and abs(d[1] - score) < 1e-3), None)
        lines.append({"text": text, "conf": float(score), "x0": x0, "y0": y0, "x1": x1, "y1": y1,
                      "cx": (x0 + x1) / 2, "cy": (y0 + y1) / 2, "w": x1 - x0, "h": y1 - y0,
                      "probs": (hit[2], hit[3]) if hit else None})
    lines.sort(key=lambda l: (l["cy"], l["x0"]))
    return lines


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
    marks = sum(m in flat for m in PASSPORT_MARKS)
    margin_number = any(l["h"] > 1.5 * l["w"] and SERIES_NUMBER_RE.search(l["text"]) for l in lines)
    if marks >= 3 or (marks >= 2 and margin_number and "ЗАРЕГИСТРИРОВАН" not in flat):
        return "passport"
    if "ЗАРЕГИСТРИРОВАН" in flat or "МЕСТОЖИТЕЛЬСТВА" in flat:
        return "passport_registration"
    return "unknown"


def same_row_right(lines, anchor):
    row = [l for l in lines if l is not anchor and abs(l["cy"] - anchor["cy"]) < 0.6 * max(l["h"], anchor["h"]) and l["x0"] > anchor["x0"]]
    return sorted(row, key=lambda l: l["x0"])


def right_of(lines, anchor):
    """Ближайшее значение справа от подписи в той же строке документа."""
    row = same_row_right(lines, anchor)
    return row[0] if row else None


def near_label(lines, word, pred, up=4.0, down=1.5):
    """Значение у мелкой подписи паспорта: правее подписи и чуть выше неё."""
    lab = next((l for l in lines if word.upper() in cyr(l["text"])), None)
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
    return bool(re.search(r"[A-Za-zА-Яа-я]{3}", t)) and t.upper() == t


def field(value, src):
    return {"value": value, "conf": round(src["conf"], 3) if src else None, "line": src}


def ru_field(src, value):
    """Поле ФИО: буквы заново выбираются только среди русских (см. RUSSIAN_ONLY). Цифры, похожие
    на буквы («3ЕБКИН»), переносят свой голос на русскую букву. Если значение — хвост строки после
    номера подписи («1. ЗЕБКИН»), перечитываем всю строку и берём буквенную часть."""
    f = field(cyr(value).translate(DIGIT_TWINS) if value else None, src)
    if RUSSIAN_ONLY and src and src.get("probs") and value and value.strip() in src["text"]:
        text, score = greedy(*src["probs"], allowed=RUSSIAN)
        text = re.sub(r"\s+", " ", text).strip()
        letters = lambda t: len(re.sub(r"[^А-ЯA-Z0-9]", "", t.upper()))
        if text and abs(letters(text) - letters(value)) <= 2:
            f["value"], f["conf"] = text, round(score, 3)
    return f


def reread_code(path, f):
    """Код подразделения («123-456»): первая цифра часто читается неверно («223»). Вырезку строки
    увеличиваем вдвое и читаем точной моделью; берём чтение, в котором нейросеть увереннее."""
    l = f["line"]
    if not l:
        return f
    img = cv2.imdecode(np.fromfile(str(path), np.uint8), cv2.IMREAD_COLOR)
    pad = int(0.4 * l["h"])
    crop = img[max(0, int(l["y0"]) - pad):int(l["y1"]) + pad, max(0, int(l["x0"]) - pad):int(l["x1"]) + pad]
    if crop.size == 0:
        return f
    big = cv2.resize(crop, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
    res = get_ocr("accurate").predict(big, use_textline_orientation=False)[0]
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
    x0, x1 = int(min(l["x0"] for l in vertical)), int(max(l["x1"] for l in vertical))
    pad = int(0.6 * (x1 - x0))
    col = img[:, max(0, x0 - pad):min(img.shape[1], x1 + pad)]
    best = []
    for rot in (cv2.ROTATE_90_COUNTERCLOCKWISE, cv2.ROTATE_90_CLOCKWISE):
        strip = cv2.resize(cv2.rotate(col, rot), None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
        # строки ищем на полосе не длиннее 2000 px (8 с вместо 20–30), читаются они с увеличенной полосы
        res = get_ocr("accurate").predict(strip, use_textline_orientation=False,
                                          text_det_limit_side_len=MARGIN_MAX_SIDE, text_det_limit_type="max")[0]
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


def mrz_correct(visual, raw):
    """Сверка ФИО бланка с МЧЗ: (значение, исправлено) или None.
    Совпало точно — подтверждение; отличается ровно одной буквой, и исправленное слово
    совпадает с МЧЗ точно и однозначно — исправление («ИБАН» + «IVAN» → «ИВАН»)."""
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
    return (found.pop(), True) if len(found) == 1 else None


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
    parts.sort(key=lambda l: (round(l["cy"] / max(l["h"], 1)), l["x0"]))
    return field(fix_letters(re.sub(r"\s+", " ", cyr(" ".join(l["text"] for l in parts))).strip()), min(parts, key=lambda l: l["conf"]))


# «ГОР.» нейросеть путает с похожими по начертанию «ФОП», «ФОР», «ГОП», «ТОР»
SETTLEMENT_FIXES = re.compile(r"(^|\s)(?:ФОП|ФОР|ГОП|ТОР|Г0Р|ГОР)(?:[.,]\s*|\s+)")


def fix_letters(value):
    """«КОJIОМНА» → «КОЛОМНА»: «Л» нейросеть часто читает как латинские «JI»."""
    return value.replace("JI", "Л") if value else value


def fix_settlement(value):
    return SETTLEMENT_FIXES.sub(lambda m: m.group(1) + "ГОР. ", value).strip() if value else value


def above_value(lines, anchor, pred, rows=6.0):
    """Ближайшая строка над значением, по центру того же столбца (фамилия над именем)."""
    c = [l for l in lines if l is not anchor and pred(l["text"]) and 0 < anchor["cy"] - l["cy"] < rows * anchor["h"]
         and abs(l["cx"] - anchor["cx"]) < 0.6 * max(l["w"], anchor["w"])]
    return min(c, key=lambda l: anchor["cy"] - l["cy"]) if c else None


def extract_passport(path, lines):
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
    place = near_label(lines, "мест", lambda t: bool(re.search(r"[А-ЯЁ]{3}", cyr(t))) and not DATE_RE.search(t) and t.upper() == t, up=2.0, down=3.0)
    if not place:
        # «Дата рождения» и «Место рождения»: подпись «Место» мелкая и теряется — берём нижнюю «рождения»
        labs = sorted((l for l in lines if "РОЖДЕН" in cyr(l["text"])), key=lambda l: -l["cy"])
        ok = lambda t: bool(re.search(r"[А-ЯЁ]{3}", cyr(t))) and not DATE_RE.search(t) and t.upper() == t and not re.search(r"МУЖ|ЖЕН", cyr(t))
        for lab in labs:
            c = [l for l in lines if l is not lab and l["x0"] > lab["x0"] + lab["h"] and -2.5 * lab["h"] < l["cy"] - lab["cy"] < 1.5 * lab["h"] and ok(l["text"])]
            if c:
                place = min(c, key=lambda l: abs(l["cy"] - lab["cy"]))
                break
    if place:
        # место рождения бывает в две строки («Г. АБИНСК» / «КРАСНОДАРСКИЙ КРАЙ») — склеиваем столбец
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
        else:
            f["birth_place"] = field(cyr(" ".join(l["text"] for l in parts)), min(parts, key=lambda l: l["conf"]))
        f["birth_place"]["value"] = fix_settlement(f["birth_place"]["value"])
    else:
        f["birth_place"] = field(None, None)
    v = near_label(lines, "рожд", lambda t: bool(DATE_RE.search(t)))
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
STS_NUMBER_RE = re.compile(r"\d{2}\s?\d{2}\s?\d{6}")
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
    c = [l for l in lines if STS_NUMBER_RE.fullmatch(l["text"].strip())]
    if not c:
        return None
    best = max(c, key=lambda l: l["conf"])
    d = re.sub(r"\s", "", best["text"])
    return {"value": f"{d[:2]} {d[2:4]} {d[4:]}", "conf": round(best["conf"], 3), "line": best,
            "copies": len({re.sub(r"\s", "", l["text"]) for l in c}), "count": len(c)}


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
    h = lab["h"]
    x0, x1 = int(lab["x0"]), int(min(W, lab["x0"] + 30 * h))
    y0, y1 = int(max(0, lab["cy"] - 1.2 * h)), int(min(H, lab["cy"] + 1.2 * h))
    strip = cv2.resize(img[y0:y1, x0:x1], None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
    res = get_ocr("accurate").predict(strip, use_textline_orientation=False)[0]
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
    f["brand"] = brand or field(None, None)
    n = sts_number(lines)
    f["sts"] = {"value": n["value"], "conf": n["conf"], "line": n["line"]} if n else field(None, None)
    f["color"] = sts_color(lines)
    f["owner"] = field(None, None)   # собственник — на обороте
    return f, n


def extract_sts_back(lines):
    """Оборот СТС: собственник (часто лизингополучатель), лизингодатель и срок временного учёта."""
    f = {}
    lab = find_line(lines, "СОБСТВЕННИК", "ВЛАДЕЛЕЦ") or find_line(lines, "СОБСТВЕННИК")
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


MONTHS = {"ЯНВАР": 1, "ФЕВРАЛ": 2, "МАРТ": 3, "АПРЕЛ": 4, "МА": 5, "ИЮН": 6, "ИЮЛ": 7, "АВГУСТ": 8,
          "СЕНТЯБР": 9, "ОКТЯБР": 10, "НОЯБР": 11, "ДЕКАБР": 12}
WORD_DATE_RE = re.compile(r"(\d{1,2})\s*(ЯНВАР|ФЕВРАЛ|МАРТ|АПРЕЛ|МА[ЯЙ]|ИЮН|ИЮЛ|АВГУСТ|СЕНТЯБР|ОКТЯБР|НОЯБР|ДЕКАБР)[А-Я]*\.?\s*(\d{4})")
# подписи штампа старого образца: «Рег-н:», «Пункт:», «Улица:», «Дом:», «Корп:», «Кв:»
ADDR_LABEL_RE = re.compile(r"(Р[ЕE][ГR][\s.-]*Н|ПУНКТ|УЛИЦА|ДОМ|КОРП(?:УС)?|КВ(?:АРТИРА)?)\s*[.:]+")
ADDR_PREFIX = {"УЛИЦА": "УЛ. ", "ДОМ": "Д. ", "КОРП": "КОРП. ", "КВ": "КВ. "}


def rows_of(lines):
    """Фрагменты одного ряда (точная модель режет «25 | Июля 2001г.») — слева направо."""
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
    month = next(n for k, n in MONTHS.items() if m.group(2).startswith(k))
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
    """«Д. 11О» → «Д. 110»: буква О рядом с цифрами — ноль."""
    return re.sub(r"(?<=\d)[ОO]|[ОO](?=\d)", "0", value) if value else value


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
    stop = next((l for l in lines if re.search(r"ОТДЕ|МИГРАЦ", l["text"].upper()) and (d is None or l["cy"] > d["cy"])), None)
    addr = [l for l in lines if d and l["cy"] > d["cy"] + 0.5 * d["h"] and (stop is None or l["cy"] < stop["cy"] - 0.5 * stop["h"])
            and len(re.sub(r"[^А-ЯA-Zа-яa-z0-9]", "", l["text"])) >= 3]
    if addr:
        worst = min(addr, key=lambda l: l["conf"])
        rows = [" ".join(l["text"] for l in r) for r in rows_of(addr)]
        f["address"] = field(fix_letters(fix_numbers(labeled_address(" ".join(rows)) or join_rows(rows))), worst)
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


def prepare(path):
    """Мелкие сканы увеличиваем вдвое: подписи паспорта высотой 10–16 px иначе не читаются."""
    img = cv2.imdecode(np.fromfile(str(path), np.uint8), cv2.IMREAD_COLOR)
    if img is None or max(img.shape[:2]) >= UPSCALE_BELOW:
        return path
    big = cv2.resize(img, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
    out = path.with_name(path.stem + "_x2.png")   # без потерь: JPEG размывает мелкие подписи
    cv2.imencode(".png", big)[1].tofile(str(out))
    return out


def scaled(path, k, suffix):
    """Копия фото, увеличенная в k раз (None — получилось бы больше 4000 px по стороне)."""
    img = cv2.imdecode(np.fromfile(str(path), np.uint8), cv2.IMREAD_COLOR)
    if img is None or max(img.shape[:2]) * k > 4000:
        return None
    big = cv2.resize(img, None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC)
    out = path.with_name(path.stem + suffix + ".png")   # без потерь, как и prepare()
    cv2.imencode(".png", big)[1].tofile(str(out))
    return out


def _needs_upscale(out):
    """Документ не узнан или главные поля не дочитаны — стоит ещё проход по увеличенному кадру."""
    f, c = out["fields"], out["confidences"]
    t = out["docType"]
    if t == "UNKNOWN":
        return True
    if t == "PASSPORT_PHOTO":
        return any(not f.get(k) for k in ("Фамилия", "Имя", "Отчество", "Дата рождения", "Серия и номер", "Дата выдачи", "Код подразделения"))
    if t == "PASSPORT_REG":
        return not f.get("Адрес регистрации") or c.get("Адрес регистрации", 0) < 0.6
    if t == "STS" and out.get("side") == "front":
        return not f.get("Госномер") or not f.get("Номер СТС")
    return False


def analyze(path, accurate_retry=True, mode=None, upscale_retry=True):
    """Фото → {quality, sharpness, docType, side, fields, confidences, confirmations, engineMode}.
    Поля называются так же, как в DOC_FIELDS (src/lib/verify.ts).

    mode (Task 83 — две нейросети по кнопкам платформы):
      "fast"     — только лёгкая модель (PP-OCRv5_mobile_det), без точного повтора —
                   кнопка «Автозаполнение» (быстро заполнить карточку);
      "accurate" — только точная модель (PP-OCRv5_server_det) — кнопка «Проверить»
                   (реальная проверка перед попаданием в базу);
      None       — прежнее поведение: быстрый проход + точный повтор, если поля не дочитаны."""
    global _mode
    from pathlib import Path
    path = Path(path)
    sharp = sharpness(path)
    quality = int(round(min(100.0, 60.0 * sharp / SHARPNESS_MIN)))
    work = prepare(path)
    try:
        if mode == "accurate":
            # сразу точная модель, быстрый проход не нужен: две модели вместе
            # + пул инференса — OOM на стенде 4 ГБ (Task 83, живые тесты)
            _mode = "accurate"
            lines = read_lines(work)
            out = _analyze_lines(work, lines, quality, sharp)
            # памяти хватает на обе модели: что точная не дочитала, добираем лёгкой
            # (на реальном паспорте лёгкая находит дату выдачи и код подразделения, точная — нет)
            if not LOW_MEMORY and (out["docType"] == "UNKNOWN" or not all(out["fields"].values())):
                _mode = "fast"
                out = _fill_gaps(out, _analyze_lines(work, read_lines(work), quality, sharp))
        else:
            _mode = "fast"
            lines = read_lines(work)
            out = _analyze_lines(work, lines, quality, sharp)
            hinted = any(h in flat_text(lines) for h in DOC_HINTS)
            if mode == "fast":
                pass                       # лёгкая модель: один проход, без точного повтора
            elif accurate_retry and _needs_retry(out) and (out["docType"] != "UNKNOWN" or hinted):
                _mode = "accurate"
                second = _analyze_lines(work, read_lines(work), quality, sharp)
                if _score(second) > _score(out):
                    out = second
        # фото с телефона: документ занимает часть кадра, шрифт мелкий, защитный фон —
        # документ не узнан или поля не дочитаны → проход по кадру, увеличенному в 1,5 раза,
        # точной моделью (на странице регистрации ошибок в адресе стало 5 из 52 знаков вместо 20)
        if upscale_retry and _needs_upscale(out):
            big = scaled(work, 1.5, "_x15")
            if big:
                try:
                    _mode = "fast" if LOW_MEMORY and mode == "fast" else "accurate"
                    out = _fill_gaps(out, _analyze_lines(big, read_lines(big), quality, sharp), margin=0.1)
                finally:
                    try:
                        os.unlink(big)
                    except OSError:
                        pass
    finally:
        _mode = "fast"
        if work != path:
            try:
                os.unlink(work)
            except OSError:
                pass
    return out


def _fill_gaps(main, extra, margin=None):
    """Пустые поля основного прохода — из второго прохода того же документа (той же стороны).
    margin — заменять и заполненные поля, если второй проход увереннее хотя бы на столько."""
    if main["docType"] == "UNKNOWN":
        return extra if extra["docType"] != "UNKNOWN" else main
    if extra["docType"] != main["docType"] or extra.get("side") != main.get("side"):
        return main
    for k, v in extra["fields"].items():
        better = margin is not None and extra["confidences"].get(k, 0) > main["confidences"].get(k, 0) + margin
        if v and (not main["fields"].get(k) or better):
            main.get("confirmations", {}).pop(k, None)
            main["fields"][k] = v
            main["confidences"][k] = extra["confidences"].get(k, 0)
            if k in extra.get("confirmations", {}):
                main.setdefault("confirmations", {})[k] = extra["confirmations"][k]
    return main


def _filled(out):
    return sum(1 for v in out["fields"].values() if v)


def _needs_retry(out):
    if out["docType"] == "UNKNOWN":
        return True
    f = out["fields"]
    if out["docType"] == "LICENSE":
        # ФИО целиком (фамилия + имя), категории и обе даты — без них ВУ не проверить
        words = [w for w in (f.get("ФИО") or "").split() if len(w) >= 2]
        return len(words) < 2 or not f.get("Категории") or not f.get("Дата выдачи") or not f.get("Действует до")
    if out["docType"] == "PASSPORT_PHOTO":
        return sum(1 for k in ("Фамилия", "Имя", "Дата рождения", "Серия и номер") if not f.get(k)) >= 2
    return False


def _score(out):
    return (out["docType"] != "UNKNOWN", _filled(out), sum(out["confidences"].values()))


def _analyze_lines(path, lines, quality, sharp):
    dtype = doc_type(lines)
    out = {"quality": quality, "sharpness": round(sharp, 1), "docType": PLATFORM_TYPE[dtype], "side": "front",
           "fields": {}, "confidences": {}, "confirmations": {}, "engineMode": _mode}

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
                    fixed = mrz_correct(cur["value"], raw)
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

def drop_models():
    """Выгрузить нейросети из памяти этого процесса (Task 83).
    Перед запуском ребёнка с точной моделью: её веса не должны делить RAM
    с быстрой моделью родителя — на стенде 4 ГБ каждая сотня мегабайт решает."""
    _ocr.clear()
    gc.collect()


def analyze_subprocess(path, mode=None):
    """analyze() в отдельном короткоживущем процессе (Task 83, стенд 4 ГБ).

    Точная нейросеть (PP-OCRv5_server_det) вместе с быстрой и пулом инференса
    не влезает в память: OOM-killer убивает сервис. Отдельный процесс загружает
    только нужную модель, распознаёт ОДИН документ и возвращает память системе.
    Вызывается для mode='accurate' (кнопка «Проверить») и для авто-повтора.

    Лимит стороны детекции выбирается по свободной памяти (точной модели нужно
    ~2 ГБ на 736px): если памяти мало, сразу стартуем с мелкого кадра; если
    ребёнка всё же убило (OOM, exit 137) — повторяем с меньшим лимитом."""
    import json as _json
    import os as _os
    import subprocess as _sp
    import sys as _sys

    def run_child(limit):
        env = dict(_os.environ)
        if limit:
            env["OCR_ACCURATE_MAX_SIDE"] = str(limit)
        # __file__ — сам engine.py (sys.argv[0] у сервера — server.py, он займет порт)
        args = [_sys.executable, _os.path.abspath(__file__), str(path), mode or "auto"]
        return _sp.run(args, capture_output=True, text=True, timeout=290, env=env)

    avail_mb = available_mb()
    if avail_mb >= 6000:
        attempts = [ACCURATE_MAX_SIDE, 736, 560]
    elif avail_mb >= 2600:
        attempts = [736, 560, 448]
    elif avail_mb >= 1900:
        attempts = [560, 448]
    else:
        attempts = [448, 384]
    last_err = "subprocess не вернул результат"
    for limit in attempts:
        run = run_child(limit)
        if run.returncode == 0:
            lines = [l for l in run.stdout.splitlines() if l.startswith("###JSON###")]
            if lines:
                return _json.loads(lines[-1][len("###JSON###"):])
        if run.stderr:
            last_err = run.stderr.strip().splitlines()[-1][:300]
    raise RuntimeError(last_err)


if __name__ == "__main__":
    # CLI для analyze_subprocess: python3 engine.py <image> [fast|accurate|auto]
    import json as _json
    import sys as _sys
    _argv_mode = _sys.argv[2] if len(_sys.argv) > 2 else None
    _mode_arg = _argv_mode if _argv_mode in ("fast", "accurate") else None
    _res = analyze(_sys.argv[1], mode=_mode_arg)
    _out = {k: _res.get(k) for k in ("quality", "sharpness", "docType", "side", "fields", "confidences", "confirmations", "engineMode")}
    print("###JSON###" + _json.dumps(_out, ensure_ascii=False))
