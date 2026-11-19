import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from collections.abc import Iterator


SCHEMA_VERSION = 1
SCHEMA = (
    """CREATE TABLE users (
        id TEXT NOT NULL PRIMARY KEY CHECK (length(id) > 0),
        username TEXT NOT NULL UNIQUE CHECK (length(username) > 0)
    ) STRICT""",
    """CREATE TABLE boards (
        id TEXT NOT NULL PRIMARY KEY CHECK (length(id) > 0),
        user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
    ) STRICT""",
    """CREATE TABLE board_columns (
        board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        id TEXT NOT NULL CHECK (length(id) > 0),
        title TEXT NOT NULL,
        position INTEGER NOT NULL CHECK (position >= 0 AND position < 5),
        PRIMARY KEY (board_id, id),
        UNIQUE (board_id, position)
    ) STRICT""",
    """CREATE TABLE cards (
        board_id TEXT NOT NULL,
        id TEXT NOT NULL CHECK (length(id) > 0),
        column_id TEXT NOT NULL,
        title TEXT NOT NULL,
        details TEXT NOT NULL,
        position INTEGER NOT NULL CHECK (position >= 0),
        PRIMARY KEY (board_id, id),
        UNIQUE (board_id, column_id, position),
        FOREIGN KEY (board_id, column_id)
            REFERENCES board_columns(board_id, id) ON DELETE CASCADE
    ) STRICT""",
)


def database_path() -> Path:
    return Path(os.environ.get("DATA_DIR", "/data")) / "kanban.sqlite3"


@contextmanager
def connection() -> Iterator[sqlite3.Connection]:
    db = sqlite3.connect(database_path(), isolation_level=None, timeout=10)
    try:
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys = ON")
        yield db
    finally:
        db.close()


@contextmanager
def transaction(db: sqlite3.Connection, *, write: bool = False) -> Iterator[None]:
    db.execute("BEGIN IMMEDIATE" if write else "BEGIN")
    try:
        yield
        db.commit()
    except BaseException:
        db.rollback()
        raise


def initialize_database() -> None:
    database_path().parent.mkdir(parents=True, exist_ok=True)
    with connection() as db, transaction(db, write=True):
        version = db.execute("PRAGMA user_version").fetchone()[0]
        if version == 0:
            for statement in SCHEMA:
                db.execute(statement)
            db.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
        elif version != SCHEMA_VERSION:
            raise RuntimeError(f"Unsupported database schema version: {version}")
