#!/usr/bin/env python3
"""Пост-обработка отчёта (совместимость WPS/Word):
1) патч instrText футеров: PAGE -> PAGE \\* ROMAN / PAGE \\* arabic по привязке секций;
2) удаление пустых <w:pgNumType/> из document.xml.
"""
import re
import shutil
import sys
import zipfile
from pathlib import Path

SRC = Path("/home/z/my-project/download/Отчет_стек_2ГИС_тестирование.docx")
TMP = Path("/tmp/report-postproc")

if TMP.exists():
    shutil.rmtree(TMP)
TMP.mkdir(parents=True)

with zipfile.ZipFile(SRC) as z:
    z.extractall(TMP)

doc_path = TMP / "word" / "document.xml"
doc = doc_path.read_text(encoding="utf-8")

# 2) пустые pgNumType (секция обложки)
before = doc.count("<w:pgNumType/>")
doc = doc.replace("<w:pgNumType/>", "")
print(f"removed empty pgNumType: {before}")

# 2b) дубль первой строки TOC: скрипт-плейсхолдер кладёт hyperlink-строку «1. …»
# в абзац начала поля TOC и ещё одну такую же plain-строкой. Убираем hyperlink
# из абзаца начала поля — видимой остаётся только plain-строка с номером страницы.
m = re.search(
    r'(<w:sdtContent><w:p><w:pPr><w:pStyle w:val="TOC1"/>.*?<w:fldChar w:fldCharType="separate"/>)(.*?)(</w:p>)',
    doc, flags=re.S,
)
if m and "<w:hyperlink" in m.group(2):
    doc = doc[:m.start(2)] + re.sub(r"<w:hyperlink.*?</w:hyperlink>", "", m.group(2), flags=re.S) + doc[m.end(2):]
    print("TOC: removed duplicate hyperlink row in field-start paragraph")
doc_path.write_text(doc, encoding="utf-8")

# 1) сопоставляем секции с их футерами через rels
rels = (TMP / "word" / "_rels" / "document.xml.rels").read_text(encoding="utf-8")
rid_to_target = dict(re.findall(r'Id="(rId\d+)"[^>]*Target="([^"]+)"', rels))

# проходим по секциям (sectPr) и определяем fmt + footerReference
sect_blocks = re.findall(r"<w:sectPr[^>]*>.*?</w:sectPr>", doc, flags=re.S)
plan = {}  # footer file -> fmt
for block in sect_blocks:
    fmt = None
    m = re.search(r'<w:pgNumType[^>]*w:fmt="([^"]+)"', block)
    if m:
        fmt = m.group(1)
    for rid in re.findall(r'<w:footerReference[^>]*r:id="(rId\d+)"', block):
        target = rid_to_target.get(rid, "")
        fname = target.split("/")[-1]
        if fmt == "upperRoman":
            plan[fname] = "ROMAN"
        elif fmt in ("decimal", None):
            plan.setdefault(fname, "arabic")

print("footer patch plan:", plan)

for fname, fmt in plan.items():
    fpath = TMP / "word" / fname
    if not fpath.exists():
        continue
    xml = fpath.read_text(encoding="utf-8")
    new_xml, n = re.subn(
        r"(<w:instrText[^>]*>)\s*PAGE\s*(</w:instrText>)",
        rf"\1 PAGE \\* {fmt} \\* MERGEFORMAT \2",
        xml,
    )
    if n:
        fpath.write_text(new_xml, encoding="utf-8")
        print(f"patched {fname}: {n} PAGE field(s) -> {fmt}")

# переупаковка
out = SRC.with_suffix(".tmp.docx")
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for p in sorted(TMP.rglob("*")):
        if p.is_file():
            z.write(p, p.relative_to(TMP).as_posix())
out.replace(SRC)
print("repacked:", SRC.name)
