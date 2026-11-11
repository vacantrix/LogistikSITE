#!/usr/bin/env python3
"""Постобработка ТЗ «Контур 1С»: номера страниц в колонтитулах + чистка pgNumType.

- Удаляет пустые <w:pgNumType/> из document.xml (секция обложки).
- Первая секция с колонтитулом (Содержание) → PAGE \\* ROMAN \\* MERGEFORMAT.
- Вторая (тело) → PAGE \\* arabic \\* MERGEFORMAT.
"""
import re
import shutil
import sys
import zipfile

path = sys.argv[1]
tmp = path + '.tmp'

with zipfile.ZipFile(path, 'r') as zin:
    names = zin.namelist()
    files = {n: zin.read(n) for n in names}

doc = files['word/document.xml'].decode('utf-8')

# 1) убрать пустые pgNumType (док-js их emits даже без pageNumbers)
doc = doc.replace('<w:pgNumType/>', '')

# 2) порядок footerReference по секциям → римские/арабские
sect_footers = []  # [(sect_idx, rid)]
for m in re.finditer(r'<w:sectPr[^>]*>.*?</w:sectPr>|<w:sectPr[^>]*/>', doc, re.S):
    block = m.group(0)
    for fm in re.finditer(r'<w:footerReference[^>]*w:type="default"[^>]*r:id="([^"]+)"', block):
        sect_footers.append(fm.group(1))

rels = files['word/_rels/document.xml.rels'].decode('utf-8')
rid_to_target = dict(re.findall(r'<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"', rels))

# Первая секция с footerReference = Содержание (ROMAN), вторая = тело (arabic)
fmt_by_file = {}
seen = []
for rid in sect_footers:
    tgt = rid_to_target.get(rid)
    if not tgt or tgt in seen:
        continue
    seen.append(tgt)
if len(seen) >= 1:
    fmt_by_file['word/' + seen[0].lstrip('/')] = 'ROMAN'
if len(seen) >= 2:
    for t in seen[1:]:
        fmt_by_file['word/' + t.lstrip('/')] = 'arabic'

patched = []
for fname, fmt in fmt_by_file.items():
    if fname not in files:
        continue
    xml = files[fname].decode('utf-8')
    new = re.sub(
        r'(<w:instrText[^>]*>)\s*PAGE\s*(</w:instrText>)',
        r'\g<1> PAGE \\* ' + fmt + r' \\* MERGEFORMAT \g<2>',
        xml,
    )
    new = new.replace('w:instr="PAGE"', 'w:instr="PAGE \\* ' + fmt + ' \\* MERGEFORMAT"')
    if new != xml:
        files[fname] = new.encode('utf-8')
        patched.append((fname, fmt))

files['word/document.xml'] = doc.encode('utf-8')

with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
    for n in names:
        zout.writestr(n, files[n])
shutil.move(tmp, path)
print('pgNumType cleaned; footers patched:', patched if patched else 'none found')
