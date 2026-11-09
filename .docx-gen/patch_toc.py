# -*- coding: utf-8 -*-
"""Правка TOC под структуру примера: первая запись — обычные runs с кэшем «1», дубль убрать."""
import re, shutil, zipfile

path = "/home/z/my-project/upload/Проектный_отчет_Веб-платформа_АЭМЗ_Логистика.docx"
tmp = path + ".tmp"

zin = zipfile.ZipFile(path, "r")
doc = zin.read("word/document.xml").decode("utf-8")

# 1) внутри первого абзаца поля TOC заменить hyperlink-блок на plain-запись с номером «1»
hyp = re.search(r'<w:hyperlink w:history="1" w:anchor="_Toc1">.*?</w:hyperlink>', doc, re.S)
assert hyp, "hyperlink первого пункта не найден"
plain_first = ('<w:r><w:t xml:space="preserve">1. Резюме проекта</w:t></w:r>'
               '<w:r><w:tab/></w:r><w:r><w:t>1</w:t></w:r>')
doc = doc[:hyp.start()] + plain_first + doc[hyp.end():]

# 2) удалить дубль первой записи (plain-абзац, следующий за абзацем поля)
dup = ('<w:p><w:pPr><w:pStyle w:val="TOC1"/><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9026"/></w:tabs>'
       '<w:spacing w:before="120" w:after="60"/></w:pPr><w:r><w:t>1. Резюме проекта</w:t></w:r>'
       '<w:r><w:tab/></w:r><w:r><w:t>1</w:t></w:r></w:p>')
if dup in doc:
    doc = doc.replace(dup, "", 1)
    print("duplicate first entry removed")
else:
    print("WARN: duplicate first entry not found (проверить вручную)")

zout = zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED)
for item in zin.infolist():
    data = zin.read(item.filename)
    if item.filename == "word/document.xml":
        data = doc.encode("utf-8")
    zout.writestr(item, data)
zout.close(); zin.close()
shutil.move(tmp, path)
print("DONE")
