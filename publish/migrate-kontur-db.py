#!/usr/bin/env python3
"""Перенос базы диспетчерской «Контур» в общую базу платформы.

Все таблицы источника получают префикс Dispatch (DispatchTrip, DispatchOrder, ...),
чтобы не пересекаться с таблицами платформы (User, Driver, Trailer, ...).
Схема копируется из sqlite_master как есть, меняется только имя таблицы;
индексы пересоздаются с префиксом в имени.

Использование:
    python publish/migrate-kontur-db.py --src <custom.db> --dst <combat.db> [--replace]

Без --replace скрипт отказывается работать, если в целевой базе уже есть
таблицы Dispatch*: случайный повторный запуск не должен дублировать данные.
"""

import argparse
import os
import re
import shutil
import sqlite3
import sys
import tempfile

PREFIX = 'Dispatch'
SYSTEM_PREFIXES = ('sqlite_', '_prisma')


def quote(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def source_tables(con: sqlite3.Connection, schema: str = 'main') -> list[str]:
    rows = con.execute(
        f"SELECT name FROM {schema}.sqlite_master "
        "WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%' "
        "ORDER BY name"
    ).fetchall()
    return [r[0] for r in rows]


def rename_table_sql(sql: str, old: str) -> str:
    """CREATE TABLE "Old" (...) -> CREATE TABLE "DispatchOld" (...)."""
    new = PREFIX + old
    pattern = re.compile(
        r'^(\s*CREATE\s+TABLE\s+)(?:"' + re.escape(old) + r'"|`' + re.escape(old) + r'`|\[' + re.escape(old) + r'\]|' + re.escape(old) + r')(?=\s*\()',
        re.IGNORECASE,
    )
    replaced, count = pattern.subn(lambda m: m.group(1) + quote(new), sql, count=1)
    if count != 1:
        raise RuntimeError(f'cannot rewrite CREATE TABLE for {old}: {sql[:120]}')
    return replaced


def rename_index_sql(sql: str, old_table: str) -> str:
    """CREATE [UNIQUE] INDEX "Old_name" ON "Old" (...) -> префикс у обоих имён."""
    pattern = re.compile(
        r'^(\s*CREATE\s+(?:UNIQUE\s+)?INDEX\s+)'
        r'(?:"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|([^\s(]+))'
        r'(\s+ON\s+)'
        r'(?:"' + re.escape(old_table) + r'"|`' + re.escape(old_table) + r'`|\[' + re.escape(old_table) + r'\]|' + re.escape(old_table) + r')'
        r'(\s*\()',
        re.IGNORECASE,
    )

    def repl(m: re.Match) -> str:
        idx_name = next(g for g in m.group(2, 3, 4, 5) if g is not None)
        return f'{m.group(1)}{quote(PREFIX + idx_name)}{m.group(6)}{quote(PREFIX + old_table)}{m.group(7)}'

    replaced, count = pattern.subn(repl, sql, count=1)
    if count != 1:
        raise RuntimeError(f'cannot rewrite index for {old_table}: {sql[:160]}')
    return replaced


def table_indexes(con: sqlite3.Connection, table: str, schema: str = 'main') -> list[str]:
    rows = con.execute(
        f"SELECT sql FROM {schema}.sqlite_master "
        "WHERE type='index' AND tbl_name=? AND sql IS NOT NULL ORDER BY name",
        (table,),
    ).fetchall()
    return [r[0] for r in rows]


def table_count(con: sqlite3.Connection, table: str, schema: str = 'main') -> int:
    return int(con.execute(f'SELECT COUNT(*) FROM {schema}.{quote(table)}').fetchone()[0])


def migrate(src: str, dst: str, replace: bool) -> int:
    if not os.path.isfile(src):
        print(f'ERROR: source not found: {src}')
        return 2
    if not os.path.isfile(dst):
        print(f'ERROR: target not found: {dst}')
        return 2
    if os.path.abspath(src) == os.path.abspath(dst):
        print('ERROR: source and target are the same file')
        return 2

    con = sqlite3.connect(dst, timeout=30)
    con.execute('PRAGMA foreign_keys=OFF')
    try:
        con.execute('ATTACH DATABASE ? AS src', (src,))
        tables = source_tables(con, 'src')
        if not tables:
            print('ERROR: source has no tables')
            return 2

        existing = [
            t for t in source_tables(con, 'main')
            if t.startswith(PREFIX)
        ]
        if existing and not replace:
            print('ERROR: target already has Dispatch* tables: ' + ', '.join(existing))
            print('Refusing to duplicate data. Re-run with --replace to rebuild them.')
            return 3
        if replace:
            con.execute('BEGIN')
            for table in existing:
                con.execute(f'DROP TABLE {quote(table)}')
            con.execute('COMMIT')
            print(f'dropped {len(existing)} existing Dispatch* tables')

        con.execute('BEGIN')
        for table in tables:
            row = con.execute(
                "SELECT sql FROM src.sqlite_master WHERE type='table' AND name=?", (table,)
            ).fetchone()
            if not row or not row[0]:
                raise RuntimeError(f'no DDL for {table}')
            con.execute(rename_table_sql(row[0], table))
            con.execute(
                f'INSERT INTO {quote(PREFIX + table)} SELECT * FROM src.{quote(table)}'
            )
        for table in tables:
            for sql in table_indexes(con, table, 'src'):
                con.execute(rename_index_sql(sql, table))
        con.execute('COMMIT')

        # Сверка: строки, схема, целостность.
        errors = []
        print(f'{"table":<22} {"rows":>8}')
        for table in tables:
            got = table_count(con, PREFIX + table)
            want = table_count(con, table, 'src')
            print(f'{PREFIX + table:<22} {got:>8}')
            if got != want:
                errors.append(f'{table}: copied {got}, expected {want}')

        integrity = con.execute('PRAGMA integrity_check').fetchone()[0]
        if integrity != 'ok':
            errors.append(f'integrity_check: {integrity}')

        expected_indexes = sum(len(table_indexes(con, t, 'src')) for t in tables)
        actual_indexes = con.execute(
            "SELECT COUNT(*) FROM main.sqlite_master WHERE type='index' AND name LIKE 'Dispatch%'"
        ).fetchone()[0]
        print(f'indexes: {actual_indexes} (expected {expected_indexes})')
        if actual_indexes != expected_indexes:
            errors.append(f'indexes: {actual_indexes}, expected {expected_indexes}')

        if errors:
            print('RESULT: FAILED')
            for e in errors:
                print(' - ' + e)
            return 1

        print(f'RESULT: OK - {len(tables)} tables, {sum(table_count(con, PREFIX + t) for t in tables)} rows')
        return 0
    except Exception:
        try:
            con.execute('ROLLBACK')
        except sqlite3.Error:
            pass
        raise
    finally:
        try:
            con.execute('DETACH DATABASE src')
        except sqlite3.Error:
            pass
        con.close()


def main() -> int:
    parser = argparse.ArgumentParser(description='Merge dispatcher DB into platform DB with Dispatch* prefix')
    parser.add_argument('--src', required=True, help='source custom.db')
    parser.add_argument('--dst', required=True, help='target combat.db')
    parser.add_argument('--replace', action='store_true', help='drop existing Dispatch* tables first')
    args = parser.parse_args()
    return migrate(args.src, args.dst, args.replace)


if __name__ == '__main__':
    sys.exit(main())
