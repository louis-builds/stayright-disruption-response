"""Postgres connection helper.

Connects directly for now (no RDS Proxy) — per CLAUDE.md, the proxy is
an AWS-deployment concern to add later. Local dev points PG* at the SSM
tunnel to the shared stayright DB (127.0.0.1:15432); see the repo-root
.env / docs/DATABASE_ACCESS.md.
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
        host=os.environ.get("PGHOST", "127.0.0.1"),
        port=os.environ.get("PGPORT", "15432"),
        dbname=os.environ.get("PGDATABASE", "stayright"),
        user=os.environ.get("PGUSER", "app"),
        password=os.environ.get("PGPASSWORD", "app_password"),
        autocommit=True,
        connect_timeout=3,
    )


def apply_sql_file(conn: psycopg.Connection[Any], path: Path) -> None:
    sql = path.read_text(encoding="utf-8")
    with conn.cursor() as cur:
        cur.execute(sql)
