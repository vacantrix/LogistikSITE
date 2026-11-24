#!/usr/bin/env python3
"""Проверить, что таблицы ИИ есть в общей базе платформы.

Платформа и диспетчерская используют одну SQLite-базу (`db/combat.db`).
Скрипт ничего не меняет: только читает список таблиц.

Коды возврата:
    0 — все таблицы ИИ на месте;
    2 — каких-то таблиц нет (нужен publish/ensure-ai-tables.ps1);
    1 — база не найдена или ошибка чтения.
"""

import os
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
    path = sys.argv[1] if len(sys.argv) > 1 else 'db/combat.db'
    if not os.path.exists(path):
        print(f'AI_TABLES=ERROR database not found: {path}', file=sys.stderr)
        return 1

    try:
        con = sqlite3.connect(path, timeout=10)
        existing = {row[0] for row in con.execute(
            "select name from sqlite_master where type='table'"
        )}
    except sqlite3.Error as exc:
        print(f'AI_TABLES=ERROR {exc}', file=sys.stderr)
        return 1
    finally:
        try:
            con.close()
        except Exception:
            pass

    missing = [table for table in AI_TABLES if table not in existing]
    if missing:
        print('AI_TABLES=MISSING ' + ','.join(missing))
        return 2

    print('AI_TABLES=OK')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
