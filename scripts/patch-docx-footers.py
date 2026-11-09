#!/usr/bin/env python3
"""
Пост-обработка .docx после генерации:
1. Патч поля номера страницы в футерах: первый footerReference документа
   (секция оглавления) → PAGE \\* ROMAN, второй (основной блок) → PAGE \\* arabic.
   WPS игнорирует pgNumType fmt — явный переключатель в instrText обязателен
   (см. skills/docx/references/toc.md § Footer Field Instruction).
2. Удаление пустых <w:pgNumType/> из document.xml (артефакт docx-js,
   сбивает WPS при отображении обложки без нумерации).

Использование: python3 scripts/patch-docx-footers.py <file.docx>
"""
import re
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path


def main(path: str) -> int:
    src = Path(path)
    if not src.exists():
        print(f"ERROR: file not found: {src}")
        return 1

    with zipfile.ZipFile(src) as zin:
        names = zin.namelist()
        data = {n: zin.read(n) for n in names}

    doc_xml = data["word/document.xml"].decode("utf-8")

    # 1. Порядок footerReference в document.xml = порядок секций с футерами.
    ref_ids = re.findall(r'<w:footerReference[^>]*r:id="(rId\d+)"', doc_xml)
    rels_xml = data["word/_rels/document.xml.rels"].decode("utf-8")
    id2target = dict(re.findall(r'<Relationship[^>]*Id="(rId\d+)"[^>]*Target="([^"]+)"', rels_xml))
    # Возможен обратный порядок атрибутов (Target раньше Id)
    for m in re.finditer(r"<Relationship\b[^>]*/>", rels_xml):
        tag = m.group(0)
        rid = re.search(r'Id="(rId\d+)"', tag)
        tgt = re.search(r'Target="([^"]+)"', tag)
        if rid and tgt:
            id2target[rid.group(1)] = tgt.group(1)

    targets = [id2target.get(r) for r in ref_ids if id2target.get(r)]
    # Убираем дубликаты (один и тот же футер может ссылаться из нескольких секций)
    uniq_targets = list(dict.fromkeys(targets))
    if len(uniq_targets) < 2:
        print(f"WARN: expected 2 footer references, found {len(uniq_targets)}: {uniq_targets}")

    formats = ["ROMAN", "arabic"]

    def patch_footer(xml: str, fmt: str) -> str:
        return re.sub(
            r"(<w:instrText[^>]*>)\s*PAGE\s*(</w:instrText>)",
            rf"\1 PAGE \\* {fmt} \\* MERGEFORMAT \2",
            xml,
        )

    patched = []
    for i, target in enumerate(uniq_targets[:2]):
        fname = "word/" + target.lstrip("/")
        if fname not in data:
            print(f"WARN: footer part not found: {fname}")
            continue
        xml = data[fname].decode("utf-8")
        new_xml = patch_footer(xml, formats[i])
        if new_xml != xml:
            data[fname] = new_xml.encode("utf-8")
            patched.append(f"{fname} -> {formats[i]}")

    # 2. Удаляем пустые <w:pgNumType/> (без атрибутов) из document.xml
    cleaned = re.sub(r"<w:pgNumType/>", "", doc_xml)
    if cleaned != doc_xml:
        data["word/document.xml"] = cleaned.encode("utf-8")
        patched.append("word/document.xml: removed empty <w:pgNumType/>")

    # Перезаписываем архив
    tmp_fd = tempfile.NamedTemporaryFile(delete=False, suffix=".docx")
    tmp_fd.close()
    with zipfile.ZipFile(tmp_fd.name, "w", zipfile.ZIP_DEFLATED) as zout:
        for n in names:
            zout.writestr(n, data[n])
    shutil.move(tmp_fd.name, src)

    print(f"OK: {src.name}")
    for p in patched:
        print(f"  patched: {p}")
    if not patched:
        print("  (nothing patched — check footer structure)")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
    sys.exit(main(sys.argv[1]))
