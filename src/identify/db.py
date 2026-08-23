"""Local Postgres connection helper.

Connects directly for now (no RDS Proxy) — per CLAUDE.md, the proxy is
an AWS-deployment concern to add later, not something local dev needs.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import psycopg
from dotenv import load_dotenv

load_dotenv()


def get_connection() -> psycopg.Connection[Any]:
    return psycopg.connect(
        host=os.environ.get("PGHOST", "localhost"),
        port=os.environ.get("PGPORT", "5432"),
        dbname=os.environ.get("PGDATABASE", "kakapo"),
        user=os.environ.get("PGUSER", "kakapo"),
        password=os.environ.get("PGPASSWORD", "kakapo"),
        autocommit=True,
        connect_timeout=3,
    )


def apply_sql_file(conn: psycopg.Connection[Any], path: Path) -> None:
    sql = path.read_text(encoding="utf-8")
    with conn.cursor() as cur:
        cur.execute(sql)
