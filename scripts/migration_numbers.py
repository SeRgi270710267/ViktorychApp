#!/usr/bin/env python3
"""Fail when two D1 migrations share a number.

Wrangler records a migration by file name and orders files by the integer
before the first underscore. Two files with the same number still both run,
but the next person can easily ship a second file that was meant to be the
next number. This check rejects that.

One pair is already on the production database and must keep its names:
renaming an applied file would make Wrangler run it again.
"""

from __future__ import annotations

import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "worker" / "migrations"

# Applied in production. Do not rename these files.
ALLOWED = {
    20: frozenset({"0020_mentions.sql", "0020_passkeys.sql"}),
}


def migration_number(name: str) -> int | None:
    stem = name.split("_", 1)[0]
    if not stem.isdigit():
        return None
    return int(stem)


def duplicates(names: list[str]) -> list[tuple[int, list[str]]]:
    grouped: dict[int, list[str]] = {}
    for name in sorted(names):
        number = migration_number(name)
        if number is None:
            continue
        grouped.setdefault(number, []).append(name)
    found = []
    for number, files in sorted(grouped.items()):
        if len(files) < 2:
            continue
        allowed = ALLOWED.get(number)
        if allowed is not None and set(files) <= allowed:
            continue
        found.append((number, files))
    return found


# From here on the worker adds columns at runtime (ensure*Columns). An
# ADD COLUMN in a migration then fails with "duplicate column" on the
# production database and every later migration is skipped with it.
NO_ADD_COLUMN_FROM = 24
ADD_COLUMN = re.compile(r"^\s*ALTER\s+TABLE\s+\S+\s+ADD\s+COLUMN", re.I | re.M)


def add_columns(directory: Path) -> list[str]:
    found = []
    for path in sorted(directory.glob("*.sql")):
        number = migration_number(path.name)
        if number is None or number < NO_ADD_COLUMN_FROM:
            continue
        if ADD_COLUMN.search(path.read_text(encoding="utf-8")):
            found.append(path.name)
    return found


def check_dir(directory: Path) -> list[tuple[int, list[str]]]:
    names = [path.name for path in directory.glob("*.sql") if path.is_file()]
    return duplicates(names)


def report(found: list[tuple[int, list[str]]]) -> int:
    if not found:
        print("migration numbers are unique")
        return 0
    print("duplicate migration numbers:", file=sys.stderr)
    for number, files in found:
        print(f"  {number}: {', '.join(files)}", file=sys.stderr)
    return 1


def selftest() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        directory = Path(tmp)
        (directory / "0001_init.sql").write_text("SELECT 1;\n", encoding="utf-8")
        (directory / "0002_next.sql").write_text("SELECT 1;\n", encoding="utf-8")
        (directory / "0020_mentions.sql").write_text("SELECT 1;\n", encoding="utf-8")
        (directory / "0020_passkeys.sql").write_text("SELECT 1;\n", encoding="utf-8")
        if check_dir(directory):
            print("the applied 0020 pair was rejected", file=sys.stderr)
            return 1
        (directory / "0020_extra.sql").write_text("SELECT 1;\n", encoding="utf-8")
        if not check_dir(directory):
            print("a third 0020 file was accepted", file=sys.stderr)
            return 1
        (directory / "0020_extra.sql").unlink()
        (directory / "0021_a.sql").write_text("SELECT 1;\n", encoding="utf-8")
        (directory / "0021_b.sql").write_text("SELECT 1;\n", encoding="utf-8")
        found = check_dir(directory)
        if len(found) != 1 or found[0][0] != 21:
            print("a new duplicate number was accepted", file=sys.stderr)
            return 1
        (directory / "0024_ok.sql").write_text("-- ALTER TABLE a ADD COLUMN b TEXT;\nSELECT 1;\n", encoding="utf-8")
        if add_columns(directory):
            print("a commented ADD COLUMN was rejected", file=sys.stderr)
            return 1
        (directory / "0025_bad.sql").write_text("ALTER TABLE a ADD COLUMN b TEXT;\n", encoding="utf-8")
        if add_columns(directory) != ["0025_bad.sql"]:
            print("an ADD COLUMN migration was accepted", file=sys.stderr)
            return 1
    print("migration number selftest passed")
    return 0


def main(argv: list[str]) -> int:
    if "--selftest" in argv:
        return selftest()
    status = report(check_dir(MIGRATIONS))
    bad = add_columns(MIGRATIONS)
    for name in bad:
        print(f"  {name}: ADD COLUMN belongs in the worker's runtime column list", file=sys.stderr)
    return 1 if bad else status


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
