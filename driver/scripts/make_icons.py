#!/usr/bin/env python3
"""
Иконка приложения водителя «АЗМЗ Логистика».
Бренд: тёмно-синий #101E2E + оранжевый #F97316 (дизайн-система Theme.kt).
Дизайн (по мотивам AI-варианта v3): оранжевый квадрат с белой галочкой + дорога с разметкой.
Рисование векторного стиля в PIL с суперсэмплингом x4.

Выходы:
  download/app-icon/master/icon-1024.png          — мастер, full-bleed квадрат
  download/app-icon/preview.png                   — превью всех форм
  public/icons/…                                  — комплект PWA
  download/azmz-karkas/android/app/src/main/res/… — комплект Android
"""
from PIL import Image, ImageDraw
import os, math

PROJECT = "/home/z/my-project"
NAVY = (16, 30, 46)        # #101E2E
NAVY_SOFT = (27, 46, 68)   # #1B2E44
ORANGE = (249, 115, 22)    # #F97316
WHITE = (255, 255, 255)

SS = 4                    # суперсэмплинг
MASTER = 1024 * SS        # рабочий холст 4096

def draw_scene(d: ImageDraw.ImageDraw, W: int, road: bool = True):
    """Рисует сцену на квадрате W x W. Координаты в долях стороны."""
    # фон
    d.rectangle([0, 0, W, W], fill=NAVY)

    cx = W / 2
    if road:
        # дорога: поверхность = фон, белый стиль: две расходящиеся кромки + осевая прерывистая
        top_y, bot_y = 0.60 * W, 1.06 * W          # верх дороги чуть под эмблемой, низ уходит за край
        half_top, half_bot = 0.075 * W, 0.30 * W   # полуширина кромок вверху/внизу
        lw_top, lw_bot = 0.016 * W, 0.052 * W      # толщина линий кромок

        # левая кромка
        d.line([(cx - half_top, top_y), (cx - half_bot, bot_y)], fill=WHITE, width=int(lw_top))
        # правая кромка
        d.line([(cx + half_top, top_y), (cx + half_bot, bot_y)], fill=WHITE, width=int(lw_top))
        # дорисовать нижние концы кромок толще (перспектива)
        d.line([(cx - half_top, top_y), (cx - half_bot, bot_y)], fill=WHITE,
               width=int(lw_bot * 0.0))  # (толщина по перспективе ниже — полигонами)

        # кромки полигонами (перспективная толщина)
        for sgn in (-1, 1):
            x1, y1 = cx + sgn * half_top, top_y
            x2, y2 = cx + sgn * half_bot, bot_y
            d.polygon([
                (x1 - lw_top / 2, y1), (x1 + lw_top / 2, y1),
                (x2 + lw_bot / 2, y2), (x2 - lw_bot / 2, y2),
            ], fill=WHITE)

        # осевая прерывистая: трапеции по центру с перспективным ростом
        n = 4
        span_t, span_b = 0.045 * W, 0.16 * W   # полуширина штриха вверху/внизу
        y0, y1 = 0.665 * W, 1.02 * W
        for i in range(n):
            t0 = i / (2 * n - 1)
            t1 = t0 + 0.9 / (2 * n - 1)
            ya = y0 + (y1 - y0) * t0
            yb = y0 + (y1 - y0) * t1
            wa = span_t + (span_b - span_t) * t0
            wb = span_t + (span_b - span_t) * t1
            d.polygon([
                (cx - wa, ya), (cx + wa, ya),
                (cx + wb, yb), (cx - wb, yb),
            ], fill=WHITE)

    # эмблема: оранжевый скруглённый квадрат с белой галочкой
    es = 0.46 * W               # сторона эмблемы
    ecx, ecy = cx, 0.40 * W     # центр эмблемы
    rad = 0.22 * es
    d.rounded_rectangle([ecx - es / 2, ecy - es / 2, ecx + es / 2, ecy + es / 2],
                        radius=rad, fill=ORANGE)

    # галочка: два толстых сегмента + круглые стыки
    t = 0.115 * es
    p1 = (ecx - 0.24 * es, ecy + 0.02 * es)
    p2 = (ecx - 0.05 * es, ecy + 0.21 * es)
    p3 = (ecx + 0.26 * es, ecy - 0.19 * es)
    d.line([p1, p2], fill=WHITE, width=int(t))
    d.line([p2, p3], fill=WHITE, width=int(t))
    for p in (p1, p2, p3):
        r = t / 2
        d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=WHITE)


def render_square(size: int, road: bool = True) -> Image.Image:
    im = Image.new("RGB", (MASTER, MASTER), NAVY)
    d = ImageDraw.Draw(im)
    draw_scene(d, MASTER, road=road)
    return im.resize((size, size), Image.LANCZOS)


def rounded(im: Image.Image, size: int, radius_frac: float = 0.18) -> Image.Image:
    """Скруглить углы (прозрачность снаружи)."""
    big = radius_frac * size * SS
    im4 = im.resize((size * SS, size * SS), Image.LANCZOS) if im.width != size * SS else im
    mask = Image.new("L", (size * SS, size * SS), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size * SS, size * SS], radius=big, fill=255)
    mask = mask.resize((size, size), Image.LANCZOS)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(im4.resize((size, size), Image.LANCZOS), (0, 0), mask)
    return out


def circle(im: Image.Image, size: int) -> Image.Image:
    im4 = im.resize((size * SS, size * SS), Image.LANCZOS)
    mask = Image.new("L", (size * SS, size * SS), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, size * SS, size * SS], fill=255)
    mask = mask.resize((size, size), Image.LANCZOS)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(im4.resize((size, size), Image.LANCZOS), (0, 0), mask)
    return out


def adaptive_foreground(size: int) -> Image.Image:
    """Foreground adaptive-иконки 108dp: эмблема по центру (безопасная зона 66/108)."""
    W = size * SS
    im = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    es = 0.42 * W
    rad = 0.22 * es
    d.rounded_rectangle([W/2 - es/2, W/2 - es/2, W/2 + es/2, W/2 + es/2], radius=rad, fill=ORANGE)
    t = 0.115 * es
    p1 = (W/2 - 0.24 * es, W/2 + 0.02 * es)
    p2 = (W/2 - 0.05 * es, W/2 + 0.21 * es)
    p3 = (W/2 + 0.26 * es, W/2 - 0.19 * es)
    d.line([p1, p2], fill=WHITE, width=int(t))
    d.line([p2, p3], fill=WHITE, width=int(t))
    for p in (p1, p2, p3):
        r = t / 2
        d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=WHITE)
    return im.resize((size, size), Image.LANCZOS)


def adaptive_background(size: int) -> Image.Image:
    """Background adaptive-иконки: тёмно-синий + дорога (эмблема — в foreground)."""
    im = Image.new("RGB", (size * SS, size * SS), NAVY)
    d = ImageDraw.Draw(im)
    W = size * SS
    cx = W / 2
    top_y, bot_y = 0.58 * W, 1.06 * W
    half_top, half_bot = 0.075 * W, 0.30 * W
    lw_top, lw_bot = 0.016 * W, 0.052 * W
    for sgn in (-1, 1):
        x1, y1 = cx + sgn * half_top, top_y
        x2, y2 = cx + sgn * half_bot, bot_y
        d.polygon([
            (x1 - lw_top / 2, y1), (x1 + lw_top / 2, y1),
            (x2 + lw_bot / 2, y2), (x2 - lw_bot / 2, y2),
        ], fill=WHITE)
    span_t, span_b = 0.045 * W, 0.16 * W
    y0, y1 = 0.63 * W, 1.02 * W
    n = 4
    for i in range(n):
        t0 = i / (2 * n - 1)
        t1 = t0 + 0.9 / (2 * n - 1)
        ya = y0 + (y1 - y0) * t0
        yb = y0 + (y1 - y0) * t1
        wa = span_t + (span_b - span_t) * t0
        wb = span_t + (span_b - span_t) * t1
        d.polygon([
            (cx - wa, ya), (cx + wa, ya), (cx + wb, yb), (cx - wb, yb),
        ], fill=WHITE)
    return im.resize((size, size), Image.LANCZOS)


def save(im: Image.Image, path: str):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if path.endswith(".jpg"):
        im.convert("RGB").save(path, quality=92)
    else:
        im.save(path)
    print("saved", path)


def main():
    master = render_square(1024)
    save(master, f"{PROJECT}/download/app-icon/master/icon-1024.png")

    # --- PWA / web (public/icons) ---
    pub = f"{PROJECT}/public/icons"
    save(rounded(master, 512), f"{pub}/icon-512.png")
    save(rounded(master, 192), f"{pub}/icon-192.png")
    # maskable: полный квадрат без скругления (лаунчер сам обрежет), контент в безопасной зоне
    save(master.resize((512, 512), Image.LANCZOS), f"{pub}/icon-maskable-512.png")
    save(master.resize((192, 192), Image.LANCZOS), f"{pub}/icon-maskable-192.png")
    save(master.resize((180, 180), Image.LANCZOS), f"{pub}/apple-touch-icon.png")
    fav = rounded(master, 48, 0.22)
    save(fav, f"{pub}/favicon-48.png")
    fav.resize((32, 32), Image.LANCZOS).save(f"{pub}/favicon-32.png")
    # favicon.ico: PIL сам отресайзит базу 48px до 16/32/48
    fav.save(f"{pub}/favicon.ico", format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])
    print("saved", f"{pub}/favicon.ico")

    # --- Android mipmaps ---
    res = f"{PROJECT}/download/azmz-karkas/android/app/src/main/res"
    dens = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
    for d_, px in dens.items():
        save(rounded(master, px, 0.18), f"{res}/mipmap-{d_}/ic_launcher.png")
        save(circle(master, px), f"{res}/mipmap-{d_}/ic_launcher_round.png")
    # adaptive 108dp: 108/162/216/324/432
    adens = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
    for d_, px in adens.items():
        save(adaptive_foreground(px), f"{res}/mipmap-{d_}/ic_launcher_foreground.png")
        save(adaptive_background(px), f"{res}/mipmap-{d_}/ic_launcher_background.png")

    anydpi = f"{res}/mipmap-anydpi-v26"
    os.makedirs(anydpi, exist_ok=True)
    xml = '''<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
'''
    for name in ("ic_launcher.xml", "ic_launcher_round.xml"):
        with open(f"{anydpi}/{name}", "w") as f:
            f.write(xml)
        print("saved", f"{anydpi}/{name}")

    # --- превью ---
    prev = Image.new("RGB", (1240, 420), (245, 247, 250))
    prev.paste(rounded(master, 380), (30, 20))
    prev.paste(circle(master, 380), (440, 20))
    prev.paste(rounded(master, 96, 0.18), (860, 40))
    prev.paste(rounded(master, 64, 0.18), (980, 56))
    prev.paste(rounded(master, 32, 0.22), (1080, 72))
    prev.paste(rounded(master, 16, 0.22), (1150, 80))
    save(prev, f"{PROJECT}/download/app-icon/preview.png")

    # AI-вариант-победитель сохраняем как референс
    import shutil
    shutil.copy(f"{PROJECT}/download/app-icon/icon-v3.png", f"{PROJECT}/download/app-icon/ai-reference-v3.png")


if __name__ == "__main__":
    main()
