# -*- coding: utf-8 -*-
"""Пост-обработка: форматы номеров страниц в колонтитулах + чистка пустых pgNumType."""
import re, shutil, zipfile, sys

path = "/home/z/my-project/upload/Проектный_отчет_Веб-платформа_АЭМЗ_Логистика.docx"
tmp = path + ".tmp"

zin = zipfile.ZipFile(path, "r")
doc = zin.read("word/document.xml").decode("utf-8")
rels = zin.read("word/_rels/document.xml.rels").decode("utf-8")

# карта rId -> файл
rid2file = dict(re.findall(r'Id="(rId\d+)"[^>]*Target="((?:header|footer)\d+\.xml)"', rels))

# секции по порядку: 0=обложка, 1=оглавление (roman), 2=тело (arabic)
sect_footers = []
for m in re.finditer(r'<w:sectPr>.*?</w:sectPr>', doc, re.S):
    s = m.group(0)
    fr = re.search(r'<w:footerReference w:type="default" r:id="(rId\d+)"/>', s)
    fmt = re.search(r'w:fmt="(\w+)"', s)
    sect_footers.append((fr.group(1) if fr else None, fmt.group(1) if fmt else None))
print("sections:", sect_footers)

patch_map = {}
for rid, fmt in sect_footers:
    if not rid:
        continue
    f = rid2file.get(rid)
    if not f:
        continue
    if fmt == "upperRoman":
        patch_map["word/" + f] = " PAGE \\* ROMAN \\* MERGEFORMAT "
    elif fmt in ("decimal", "lowerRoman", "arabic"):
        patch_map["word/" + f] = " PAGE \\* arabic \\* MERGEFORMAT "
print("patch:", patch_map)

# чистка пустых pgNumType (обложка)
doc2 = doc.replace("<w:pgNumType/>", "")
removed = len(doc) - len(doc2)

zout = zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED)
for item in zin.infolist():
    data = zin.read(item.filename)
    if item.filename == "word/document.xml":
        data = doc2.encode("utf-8")
    elif item.filename in patch_map:
        xml = data.decode("utf-8")
        xml, n = re.subn(
            r'(<w:instrText[^>]*>)\s*PAGE\s*(</w:instrText>)',
            lambda m: m.group(1) + patch_map[item.filename] + m.group(2),
            xml)
        print(f"{item.filename}: patched {n} PAGE field(s)")
        data = xml.encode("utf-8")
    zout.writestr(item, data)
zout.close(); zin.close()
shutil.move(tmp, path)
print("removed empty pgNumType:", removed)
print("DONE")
