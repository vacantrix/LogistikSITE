"""Тестовые образцы документов для проверки распознавания.

Данные выдуманные, на каждом образце — штамп «ОБРАЗЕЦ». Оформление упрощённое:
нужна только раскладка полей, чтобы проверить чтение текста и шаблоны.
Каждый образец «фотографируется»: наклон, перспектива, тень, шум, JPEG-сжатие.
"""
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).parent / "samples"
FONT = "C:/Windows/Fonts/arial.ttf"
FONT_B = "C:/Windows/Fonts/arialbd.ttf"


def font(size, bold=False):
    return ImageFont.truetype(FONT_B if bold else FONT, size)


def stamp(d, x, y):
    d.rounded_rectangle([x, y, x + 250, y + 70], radius=10, outline=(200, 40, 40), width=5)
    d.text((x + 125, y + 35), "ОБРАЗЕЦ", font=font(38, True), fill=(200, 40, 40), anchor="mm")


def driver_license():
    w, h = 1280, 820
    img = Image.new("RGB", (w, h), (252, 236, 240))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, w, 110], fill=(236, 205, 214))
    d.text((40, 30), "ВОДИТЕЛЬСКОЕ УДОСТОВЕРЕНИЕ", font=font(46, True), fill=(60, 30, 50))
    d.text((w - 150, 32), "RUS", font=font(44, True), fill=(60, 30, 50))
    d.rectangle([40, 150, 330, 520], fill=(214, 214, 220))
    d.text((185, 335), "ФОТО", font=font(36), fill=(120, 120, 130), anchor="mm")
    rows = [
        ("1.", "ИВАНОВ"),
        ("", "IVANOV"),
        ("2.", "ИВАН ИВАНОВИЧ"),
        ("", "IVAN IVANOVICH"),
        ("3.", "15.05.1990"),
        ("", "Г. МОСКВА"),
        ("4a)", "12.03.2020    4b) 12.03.2030"),
        ("4c)", "ГИБДД 7701"),
        ("5.", "99 12 345678"),
        ("8.", "Г. МОСКВА"),
    ]
    y = 140
    for n, t in rows:
        if n:
            d.text((370, y), n, font=font(34, True), fill=(40, 40, 60))
        d.text((450, y), t, font=font(36, n != ""), fill=(20, 20, 40))
        y += 54
    d.text((40, 700), "9.", font=font(34, True), fill=(40, 40, 60))
    d.text((100, 700), "B, B1, C, C1, CE, C1E, M", font=font(36, True), fill=(20, 20, 40))
    stamp(d, w - 300, h - 110)
    return img


def sts():
    w, h = 1280, 820
    img = Image.new("RGB", (w, h), (238, 244, 236))
    d = ImageDraw.Draw(img)
    d.text((w // 2, 50), "СВИДЕТЕЛЬСТВО О РЕГИСТРАЦИИ", font=font(42, True), fill=(30, 60, 40), anchor="mm")
    d.text((w // 2, 100), "ТРАНСПОРТНОГО СРЕДСТВА", font=font(42, True), fill=(30, 60, 40), anchor="mm")
    d.text((w - 330, 150), "99 00 123456", font=font(38, True), fill=(150, 30, 30))
    rows = [
        ("Регистрационный знак", "А123ВС777"),
        ("Идентификационный номер (VIN)", "XW8ZZZ61ZKG123456"),
        ("Марка, модель", "КАМАЗ 5490"),
        ("Тип ТС", "ГРУЗОВОЙ ТЯГАЧ СЕДЕЛЬНЫЙ"),
        ("Категория ТС", "C"),
        ("Год выпуска ТС", "2019"),
        ("Собственник", "ООО ПЕРЕВОЗЧИК А"),
    ]
    y = 220
    for k, v in rows:
        d.text((50, y), k, font=font(32), fill=(60, 70, 60))
        d.text((640, y), v, font=font(36, True), fill=(20, 30, 20))
        y += 70
    stamp(d, w - 300, h - 110)
    return img


def photograph(card, angle=3.0, blur=0.0, seed=1):
    """Имитация снимка с телефона: карточка на столе, перспектива, тень, шум."""
    rng = np.random.default_rng(seed)
    c = cv2.cvtColor(np.array(card), cv2.COLOR_RGB2BGR)
    h, w = c.shape[:2]
    W, H = int(w * 1.25), int(h * 1.35)
    bg = np.full((H, W, 3), (92, 104, 118), np.uint8)
    bg = cv2.GaussianBlur((bg + rng.normal(0, 6, bg.shape)).clip(0, 255).astype(np.uint8), (0, 0), 3)
    src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    ox, oy = (W - w) / 2, (H - h) / 2
    dst = np.float32([[ox + 25, oy + 10], [ox + w - 10, oy + 35], [ox + w + 15, oy + h - 5], [ox - 5, oy + h + 15]])
    M = cv2.getPerspectiveTransform(src, dst)
    R = cv2.getRotationMatrix2D((W / 2, H / 2), angle, 1.0)
    warped = cv2.warpPerspective(c, M, (W, H), borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    mask = cv2.warpPerspective(np.full((h, w), 255, np.uint8), M, (W, H))
    warped = cv2.warpAffine(warped, R, (W, H))
    mask = cv2.warpAffine(mask, R, (W, H))
    out = np.where(mask[..., None] > 0, warped, bg)
    # тень и неравномерный свет
    gx = np.linspace(0.78, 1.08, W)[None, :, None]
    gy = np.linspace(1.04, 0.86, H)[:, None, None]
    out = (out * gx * gy + rng.normal(0, 5, out.shape)).clip(0, 255).astype(np.uint8)
    if blur:
        out = cv2.GaussianBlur(out, (0, 0), blur)
    ok, buf = cv2.imencode(".jpg", out, [cv2.IMWRITE_JPEG_QUALITY, 82])
    return buf


def main():
    OUT.mkdir(exist_ok=True)
    cases = {
        "vu_ok.jpg": photograph(driver_license(), angle=2.5, seed=1),
        "vu_blurry.jpg": photograph(driver_license(), angle=-3.0, blur=4.2, seed=2),
        "sts_ok.jpg": photograph(sts(), angle=-2.0, seed=3),
    }
    for name, buf in cases.items():
        (OUT / name).write_bytes(buf.tobytes())
        print("saved", name)


if __name__ == "__main__":
    main()
