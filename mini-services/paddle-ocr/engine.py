"""Чтение документов перевозчика: PaddleOCR + шаблоны полей.

PaddleOCR (три нейросети: поиск строк, ориентация строк, чтение) только читает текст.
Дальше обычный код: тип документа по ключевым словам, поля по шаблону и независимые
подтверждения, которые видны на самом документе (копии номера на полях паспорта,
латинская строка ВУ, повторное чтение категорий, срок ВУ = выдача + 10 лет).

Правила проверки (сверка с заявкой, пороги, статусы) — на платформе (src/lib/verify.ts):
сервис получает только фото и ничего не знает о заявке.

Поддерживаются: паспорт РФ (страница с фото; серия и номер — с полей страницы),
страница регистрации, водительское удостоверение, СТС.
"""
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
                 "driver_license": "LICENSE", "vehicle_registration": "STS", "unknown": "UNKNOWN"}
SUPPORTED = {"PASSPORT_PHOTO", "PASSPORT_REG", "LICENSE", "STS"}


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

_ocr = None

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


TWINS = list(zip("ABEKMHOPCTYXaeopcxy", "АВЕКМНОРСТУХаеорсху"))   # латинская буква → русская того же вида


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


def get_ocr():
    global _ocr
    if _ocr is None:
        from paddleocr import PaddleOCR
        if RUSSIAN_ONLY:
            _hook_decoder()
        # enable_mkldnn=False: в PaddlePaddle 3.3 ускоритель oneDNN падает на этих моделях
        _ocr = PaddleOCR(lang="ru", use_doc_orientation_classify=False, use_doc_unwarping=False,
                         use_textline_orientation=True, enable_mkldnn=False)
    return _ocr


def read_lines(path):
    ocr = get_ocr()
    _PROBS.clear()
    res = ocr.predict(str(path))[0]
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

def doc_type(lines):
    text = " ".join(l["text"].upper() for l in lines)
    if "ВОДИТЕЛЬСК" in text:
        return "driver_license"
    if "СВИДЕТЕЛЬСТВО" in text and ("РЕГИСТРАЦ" in text or "ТРАНСПОРТН" in text):
        return "vehicle_registration"
    if "ФАМИЛИЯ" in text and "ОТЧЕСТВО" in text:
        return "passport"
    if "ЗАРЕГИСТРИРОВАН" in text or "ЖИТЕЛЬСТВ" in text:
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
    lab = next((l for l in lines if word in l["text"].lower()), None)
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
    """Поле ФИО. Если значение — вся строка, буквы заново выбираются только среди русских (см. RUSSIAN_ONLY)."""
    f = field(cyr(value) if value else None, src)
    if RUSSIAN_ONLY and src and src.get("probs") and value == src["text"] and not re.search(r"\d", value):
        text, score = greedy(*src["probs"], allowed=RUSSIAN)
        if text.strip():
            f["value"], f["conf"] = re.sub(r"\s+", " ", text).strip(), round(score, 3)
    return f


# ---------------- паспорт: серия и номер на полях страницы ----------------

def read_margin_number(path, lines):
    """Серия и номер напечатаны вертикально на полях обеих страниц. Вырезаем эту полосу, поворачиваем,
    увеличиваем и читаем ещё раз. Проверку ориентации строк здесь выключаем: на коротких цифрах (0, 3, 8)
    она путает верх и низ. Вместо неё читаем оба поворота и берём тот, где номер нашёлся."""
    vertical = [l for l in lines if l["h"] > 1.5 * l["w"] and any(c.isdigit() for c in l["text"])]
    if not vertical:
        return []
    img = cv2.imdecode(np.fromfile(str(path), np.uint8), cv2.IMREAD_COLOR)
    x0, x1 = int(min(l["x0"] for l in vertical)), int(max(l["x1"] for l in vertical))
    pad = int(0.6 * (x1 - x0))
    col = img[:, max(0, x0 - pad):min(img.shape[1], x1 + pad)]
    best = []
    for rot in (cv2.ROTATE_90_COUNTERCLOCKWISE, cv2.ROTATE_90_CLOCKWISE):
        strip = cv2.resize(cv2.rotate(col, rot), None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
        res = get_ocr().predict(strip, use_textline_orientation=False)[0]
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


def extract_passport(path, lines):
    f = {}
    for key, word in (("surname", "фамил"), ("name", "имя"), ("patronymic", "отчеств")):
        v = near_label(lines, word, is_upper_word)
        f[key] = ru_field(v, v["text"] if v else None)
    v = near_label(lines, "рожд", lambda t: bool(DATE_RE.search(t)))
    f["birth_date"] = field(DATE_RE.search(v["text"]).group(0) if v else None, v)
    copies = read_margin_number(path, lines)
    if copies:
        top = max(copies, key=lambda c: c["conf"])
        f["series_number"] = {"value": f"{top['series'][:2]} {top['series'][2:]} {top['number']}", "conf": top["conf"], "line": None}
    else:
        f["series_number"] = field(None, None)
    v = near_label(lines, "выдач", lambda t: bool(DATE_RE.search(t)))
    f["issue_date"] = field(DATE_RE.search(v["text"]).group(0) if v else None, v)
    v = next((l for l in lines if re.fullmatch(r"\d{3}-\d{3}", l["text"].strip())), None)
    f["dept"] = field(v["text"].strip() if v else None, v)
    return f, copies


# ---------------- шаблоны ВУ, СТС, регистрации ----------------

LABEL_RE = re.compile(r"^\s*(1|2|3|4[aаAА]|4[bвBВ]|4[cсCС]|5|8|9)\s*[.\),:]\s*(.*)$")
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
    res = get_ocr().predict(strip, use_textline_orientation=False)[0]
    found = {}
    for t, s, p in sorted(zip(res["rec_texts"], res["rec_scores"], res["rec_polys"]), key=lambda r: np.array(r[2])[:, 0].min()):
        for x in re.split(r"[,.\s|\[\]()]+", t.upper().translate(CYR2LAT)):
            x = re.sub(r"^([ABCD])[IL]", r"\g<1>1", x)   # B1 часто читается как BI
            if x in CATEGORIES and x not in found:
                found[x] = float(s)
    return found


def extract_driver_license(path, lines):
    labels = {}
    for l in lines:
        m = LABEL_RE.match(l["text"])
        if m:
            labels[m.group(1)[0] + SUFFIX.get(m.group(1)[1:], "")] = (m.group(2).strip() or None, l)

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
    f["surname"] = ru_field(src, v)
    v, src = by_label("2")
    f["name"] = ru_field(src, v)
    dated = sorted([(parse_date(l["text"]), l) for l in lines if parse_date(l["text"])], key=lambda t: t[0])
    v3, s3 = by_label("3")
    birth = (v3, s3) if parse_date(v3) else ((dated[0][1]["text"], dated[0][1]) if dated else (None, None))
    f["birth_date"] = field(DATE_RE.search(birth[0]).group(0) if birth[0] else None, birth[1])
    v4a, s4a = by_label("4a")
    if not parse_date(v4a):
        s4a = next((l for l in lines if re.search(r"4\s*[aаAА]\)", l["text"]) and parse_date(l["text"])), None)
        v4a = s4a["text"] if s4a else None
    f["issue_date"] = field(DATE_RE.search(v4a).group(0) if v4a else None, s4a)
    exp = next((l for l in lines if re.search(r"4\s*[bвBВ]\)", l["text"]) and parse_date(l["text"])), dated[-1][1] if dated else None)
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


def extract_vehicle_registration(lines):
    def after(word):
        a = next((l for l in lines if word in l["text"].lower()), None)
        v = right_of(lines, a) if a else None
        return (v["text"], v) if v else (None, None)

    f = {}
    v, src = after("регистрационный знак")
    if not v:
        src = next((l for l in lines if re.fullmatch(r"[АВЕКМНОРСТУХ]\d{3}[АВЕКМНОРСТУХ]{2}\d{2,3}", norm_plate(l["text"]))), None)
        v = src["text"] if src else None
    f["plate"] = field(norm_plate(v) if v else None, src)
    v, src = after("идентификационный")
    if not v:
        src = next((l for l in lines if re.fullmatch(r"[A-Z0-9]{17}", norm_vin(l["text"]))), None)
        v = src["text"] if src else None
    f["vin"] = field(norm_vin(v) if v else None, src)
    v, src = after("собственник")
    f["owner"] = field(v, src)
    return f


def extract_registration(lines):
    f = {}
    head = next((l for l in lines if "ЗАРЕГИСТРИРОВАН" in l["text"].upper()), None)
    d = next((l for l in lines if parse_date(l["text"]) and (head is None or l["cy"] > head["cy"])), None)
    f["reg_date"] = field(DATE_RE.search(d["text"]).group(0) if d else None, d)
    stop = next((l for l in lines if re.search(r"ОТДЕ|МИГРАЦ", l["text"].upper()) and (d is None or l["cy"] > d["cy"])), None)
    addr = [l for l in lines if d and l["cy"] > d["cy"] + 0.5 * d["h"] and (stop is None or l["cy"] < stop["cy"] - 0.5 * stop["h"])
            and len(re.sub(r"[^А-ЯA-Zа-яa-z0-9]", "", l["text"])) >= 3]
    if addr:
        worst = min(addr, key=lambda l: l["conf"])
        f["address"] = field(", ".join(cyr(l["text"]) for l in addr), worst)
    else:
        f["address"] = field(None, None)
    v = next((l for l in lines if re.fullmatch(r"\d{3}-\d{3}", l["text"].strip())), None)
    f["dept"] = field(v["text"].strip() if v else None, v)
    return f


# ---------------- итог в формате платформы ----------------

def analyze(path):
    """Фото → {quality, sharpness, docType, fields, confidences, confirmations} в терминах платформы.
    Поля называются так же, как в DOC_FIELDS (src/lib/verify.ts)."""
    sharp = sharpness(path)
    quality = int(round(min(100.0, 60.0 * sharp / SHARPNESS_MIN)))
    lines = read_lines(path)
    dtype = doc_type(lines)
    out = {"quality": quality, "sharpness": round(sharp, 1), "docType": PLATFORM_TYPE[dtype],
           "fields": {}, "confidences": {}, "confirmations": {}}

    def put(label, f):
        out["fields"][label] = f["value"] or ""
        out["confidences"][label] = float(f["conf"] or 0.0)

    def confirm(label, text):
        out["confirmations"].setdefault(label, []).append(text)

    if dtype == "passport":
        f, copies = extract_passport(path, lines)
        put("Фамилия", f["surname"])
        put("Имя", f["name"])
        put("Отчество", f["patronymic"])
        put("Дата рождения", f["birth_date"])
        put("Серия и номер", f["series_number"])
        put("Дата выдачи", f["issue_date"])
        put("Код подразделения", f["dept"])
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
        f = extract_vehicle_registration(lines)
        put("Госномер", f["plate"])
        put("VIN", f["vin"])
        put("Владелец", f["owner"])
        # номер СТС и марка шаблоном пока не читаются — платформа отправит их на ручную сверку
        out["fields"]["Номер СТС"], out["confidences"]["Номер СТС"] = "", 0.0
        out["fields"]["Марка"], out["confidences"]["Марка"] = "", 0.0

    elif dtype == "passport_registration":
        f = extract_registration(lines)
        put("Дата регистрации", f["reg_date"])
        put("Код подразделения", f["dept"])
        put("Адрес регистрации", f["address"])

    return out
