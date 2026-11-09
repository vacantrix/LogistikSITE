# -*- coding: utf-8 -*-
"""Диаграмма дорожной карты (аналог Рисунок 1 из примера): 1639x600 px."""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

TEAL = "#529286"
NAVY = "#0B1C2C"
ORANGE = "#BF7A3F"
GRAY = "#666666"

# (подпись, старт недели, конец недели, цвет, подпись на полосе, кегль подписи)
stages = [
    ("Этап 0. Демо-стенд\nплатформа · шина 1С · OCR · мок-ЭДО", 0, 1, TEAL, "готов", 10),
    ("Этап 1. Интеграция 1С\nбоевой ключ · регламент · выгрузка заявок", 0, 3, TEAL, "3 нед.", 11),
    ("Этап 2. OCR-пилот v6\n20–50 документов каждого типа", 1, 5, TEAL, "4 нед.", 11),
    ("Этап 3. Боевой ЭДО и публикация\nДиадок · чистка git · сервер АЭМЗ", 4, 10, TEAL, "6 нед.", 11),
    ("Этап 4. Дашборд и аналитика\nKPI · ставки · журнал обмена", 10, 16, NAVY, "6 нед.", 11),
]
milestones = [
    (0, "Стенд работает", "left"),
    (3, "Обмен с 1С в бою", "left"),
    (5, "OCR-пилот готов", "left"),
    (10, "ЭТрН в бою", "left"),
    (16, "Промышленная эксплуатация", "right"),
]

n = len(stages)
fig, ax = plt.subplots(figsize=(13.658, 5.0), dpi=120)

for i, (label, s, e, color, blabel, bsize) in enumerate(stages):
    y = n - 1 - i
    ax.barh(y, e - s, left=s, height=0.5, color=color, edgecolor="none", zorder=3)
    ax.text((s + e) / 2, y, blabel, ha="center", va="center",
            color="white", fontsize=bsize, fontweight="bold", zorder=4)
    ax.text(-0.15, y, label, ha="right", va="center", fontsize=11.5, color="#333333")

top = n - 0.25
for w, t, ha in milestones:
    ax.vlines(w, -0.28, top, color=ORANGE, lw=1.1, linestyle=(0, (4, 3)), alpha=0.85, zorder=2)
    ax.plot([w], [top], marker="D", ms=7, color=ORANGE, zorder=5, clip_on=False)
    ax.text(w + (0.25 if ha == "left" else -0.25), top + 0.18, t, ha=ha, va="bottom",
            fontsize=11, fontweight="bold", color=ORANGE, zorder=5)

ax.set_xlim(-0.05, 16.35)
ax.set_ylim(-0.55, n + 0.45)
ax.set_xticks(range(0, 17, 4))
ax.set_yticks([])
ax.grid(axis="x", color="#DDDDDD", lw=0.8, zorder=0)
ax.tick_params(axis="x", labelsize=11, colors=GRAY, length=0)
for side in ("top", "right", "left"):
    ax.spines[side].set_visible(False)
ax.spines["bottom"].set_color("#AAAAAA")
ax.set_xlabel("Недели проекта (суммарно около четырёх месяцев до промышленной эксплуатации)",
              fontsize=11, color=GRAY, labelpad=8)
fig.subplots_adjust(left=0.275, right=0.985, top=0.93, bottom=0.15)
fig.savefig("/home/z/my-project/.docx-gen/roadmap.png")
print("saved px:", int(round(13.658 * 120)), int(round(5.0 * 120)))
