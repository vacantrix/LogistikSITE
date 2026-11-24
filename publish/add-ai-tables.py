#!/usr/bin/env python3
"""Безопасно добавить таблицы ИИ в общую базу платформы.

В монорепозитории платформа и диспетчерская живут в одной SQLite-базе
(`db/combat.db`): у диспетчерских таблиц префикс Dispatch. Обычный
`prisma db push` синхронизирует базу под одну схему и удаляет «чужие»
таблицы, поэтому для существующей базы он неприменим.

Скрипт берёт DDL только недостающих таблиц ИИ из временной базы, созданной
по `prisma/schema.prisma`, и добавляет их в целевую базу. Существующие
таблицы, данные и индексы не трогаются.

Использование:
    python publish/add-ai-tables.py --source <tmp-platform.db> --target <combat.db>
"""

import argparse
import sqlite3
import sys

AI_TABLES = [
    'MemoryContact',
    'MemoryDeal',
    'AiListItem',
    'AiFavorite',
    'AiFavoriteMessage',
    'AiLog',
    'AiChatMessage',
    'AiRight',
]


def main() -> int:
    parser = argparse.ArgumentParser(description='Добавить недостающие таблицы ИИ в базу платформы.')
    parser.add_argument('--source', required=True, help='временная база, созданная по prisma/schema.prisma')
    parser.add_argument('--target', required=True, help='рабочая база платформы (db/combat.db)')
    args = parser.parse_args()

    src = sqlite3.connect(args.source)
    tgt = sqlite3.connect(args.target)
    created: list[str] = []
    skipped: list[str] = []

    try:
        existing = {r[0] for r in tgt.execute("select name from sqlite_master where type='table'")}

        for table in AI_TABLES:
            if table in existing:
                skipped.append(table)
                continue

            row = src.execute(
                "select sql from sqlite_master where type='table' and name=?",
                (table,),
            ).fetchone()
            if not row or not row[0]:
                print(f'ERROR: в источнике нет таблицы {table}', file=sys.stderr)
                return 1

            tgt.execute(row[0])
            created.append(table)

            indexes = src.execute(
                "select name, sql from sqlite_master "
                "where type='index' and tbl_name=? and sql is not null order by rowid",
                (table,),
            ).fetchall()
            for name, sql in indexes:
                tgt.execute(sql)
                created.append(f'index {name}')

        tgt.commit()

        check = {r[0] for r in tgt.execute("select name from sqlite_master where type='table'")}
        missing = [t for t in AI_TABLES if t not in check]
        if missing:
            print(f'ERROR: не созданы таблицы: {", ".join(missing)}', file=sys.stderr)
            return 1
    finally:
        src.close()
        tgt.close()

    print('CREATED=' + (','.join(created) if created else 'none'))
    print('SKIPPED=' + (','.join(skipped) if skipped else 'none'))
    print('AI_TABLES=OK')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
