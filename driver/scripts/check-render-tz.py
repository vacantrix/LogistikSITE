#!/usr/bin/env python3
"""Проверка рендера ТЗ: пустые страницы, обложка, структура текста по страницам."""
import subprocess
import sys
from PIL import Image
import glob

pages = sorted(glob.glob('/tmp/render/page-*.jpg'))
print(f'Страниц: {len(pages)}')

# 1) пиксельная статистика
blank = []
dark_cover = None
for p in pages:
    img = Image.open(p).convert('L')
    px = list(img.getdata())
    n = len(px)
    nonwhite = sum(1 for v in px if v < 245) / n
    dark = sum(1 for v in px if v < 80) / n
    num = p.split('-')[-1].split('.')[0]
    if nonwhite < 0.01:
        blank.append(num)
    if num == '01':
        dark_cover = dark
    # короткая сводка
print('Пустые страницы:', blank if blank else 'нет')
print(f'Обложка: доля тёмных пикселей = {dark_cover:.2%} (ожидаемо > 60% — тёмно-синий фон)')

# 2) текст по страницам
out = subprocess.run(['pdftotext', '-layout', '/tmp/render/ТЗ_Веб-платформа_Контур_1С.pdf', '-'],
                     capture_output=True, text=True).stdout
doc_pages = out.split('\f')
for i, pg in enumerate(doc_pages[:len(pages)], 1):
    lines = [l.strip() for l in pg.splitlines() if l.strip()]
    head = ' | '.join(lines[:3])[:150]
    tail = lines[-1][:40] if lines else ''
    print(f'стр {i:2d}: {head}  ...  [{tail}]')

# 3) маркеры проблем
problems = []
if 'undefined' in out or 'NaN' in out or 'TODO' in out or 'XXX' in out:
    problems.append('найден мусор undefined/NaN/TODO/XXX')
for md in ['|---|', '**', '##']:
    if md in out:
        problems.append(f'маркдаун-артефакт: {md}')
print('Проблемы:', problems if problems else 'нет')
