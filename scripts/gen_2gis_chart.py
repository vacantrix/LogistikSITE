#!/usr/bin/env python3
"""Диаграмма латентности Routing API 2ГИС: напрямую vs через прокси демо (реальные данные из 2gis-report.json)."""
import json
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

plt.rcParams["font.sans-serif"] = ["DejaVu Sans"]
plt.rcParams["axes.unicode_minus"] = False

direct = {r["test"]: r for r in json.load(open("/home/z/my-project/download/2gis-tests/2gis-report.json"))["results"]}
proxy = {r["test"]: r for r in json.load(open("/home/z/my-project/download/2gis-tests-proxy/2gis-report.json"))["results"]}

order = ["T1", "T2a", "T2b", "T3", "T4a", "T5"]
labels = ["T1\nгород ~1,7 км", "T2a\nА-146, car", "T2b\nА-146, truck 18 т", "T3\nрейс ~65 км", "T4a\nstatistics", "T5\nальтернативы"]
d = [direct[t]["latency_ms"] for t in order]
p = [proxy[t]["latency_ms"] for t in order]

x = np.arange(len(order))
w = 0.38
fig, ax = plt.subplots(figsize=(8.6, 4.1), constrained_layout=True)
b1 = ax.bar(x - w / 2, d, w, label="Напрямую в Routing API", color="#0B1C2C")
b2 = ax.bar(x + w / 2, p, w, label="Через прокси демо", color="#529286")
ax.bar_label(b1, fmt="%d", fontsize=8, padding=1, color="#0B1C2C")
ax.bar_label(b2, fmt="%d", fontsize=8, padding=1, color="#2F6B60")
ax.set_ylabel("Латентность, мс", fontsize=10)
ax.set_xticks(x)
ax.set_xticklabels(labels, fontsize=8.5)
ax.set_ylim(0, 1300)
ax.legend(loc="upper left", fontsize=9, frameon=False)
ax.spines["top"].set_visible(False)
ax.spines["right"].set_visible(False)
ax.grid(axis="y", alpha=0.25, linewidth=0.6)
fig.savefig("/home/z/my-project/download/2gis-tests/latency-chart.png", dpi=200)
print("chart saved")
