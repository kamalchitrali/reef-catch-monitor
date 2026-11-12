import os
import sqlite3
from contextlib import closing
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(os.environ.get("REEF_DATA_DIR", ROOT / "data"))
DATABASE_URL = os.environ.get("REEF_DATABASE_URL", "")

from .migrations import apply_migrations


class PostgresCompat:
    is_postgres = True

    def __init__(self, connection):
        self.connection = connection

    def execute(self, sql, parameters=()):
        return self.connection.execute(sql.replace("?", "%s"), parameters)

    def executescript(self, sql):
        for statement in sql.split(";"):
            if statement.strip():
                self.connection.execute(statement)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        if exc_type is None:
            self.connection.commit()
        else:
            self.connection.rollback()

    def close(self):
        self.connection.close()


def connect():
    if DATABASE_URL.startswith(("postgres://", "postgresql://")):
        try:
            import psycopg
        except ImportError as error:
            raise RuntimeError("Install backend requirements to use PostgreSQL.") from error
        return PostgresCompat(psycopg.connect(DATABASE_URL))
    db = sqlite3.connect(DATA / "catches.sqlite3", timeout=15)
    db.execute("PRAGMA foreign_keys = ON")
    db.execute("PRAGMA busy_timeout = 15000")
    return db


def init_db() -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    with closing(connect()) as db, db:
        if not getattr(db, "is_postgres", False):
            db.execute("PRAGMA journal_mode = WAL")
            db.execute("BEGIN IMMEDIATE")
        apply_migrations(db)


def assign_legacy_catches(email: str) -> int:
    """Assign records from the single-user version to an explicitly chosen account."""
    with closing(connect()) as db, db:
        user = db.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
        if user is None:
            raise ValueError("Create the target account before assigning old catches.")
        return db.execute("UPDATE catches SET owner_id = ? WHERE owner_id IS NULL", (user[0],)).rowcount
