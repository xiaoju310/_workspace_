"""SQLite 数据库初始化模块。

目前只创建第一天需要的核心表：books、pages、runs、jobs。
字段与 docs/设计文档.md 的首版数据结构保持一致，后续再扩展。
"""

import os
import sqlite3
from pathlib import Path


# 允许通过环境变量切换数据库位置；默认放在项目 data/ 目录。
PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATABASE_PATH = Path(os.getenv("DATABASE_PATH", str(PROJECT_ROOT / "data" / "paper_companion.db")))


SCHEMA = """
CREATE TABLE IF NOT EXISTS books (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    authorization_ref TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pages (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL REFERENCES books(id),
    page_no INTEGER NOT NULL,
    image_path TEXT,
    sha256 TEXT,
    ocr_json TEXT,
    vision_json TEXT,
    revision INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE(book_id, page_no)
);

CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL REFERENCES books(id),
    status TEXT NOT NULL,
    config_json TEXT NOT NULL,
    model_manifest_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    finished_at TEXT
);

CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    run_id TEXT REFERENCES runs(id),
    stage TEXT NOT NULL,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    started_at TEXT,
    ended_at TEXT,
    created_at TEXT NOT NULL
);
"""


def get_connection() -> sqlite3.Connection:
    """创建一个带外键检查的 SQLite 连接。"""

    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def initialize_database() -> None:
    """创建表并开启 WAL，便于 API 和未来 worker 同时访问。"""

    with get_connection() as connection:
        connection.execute("PRAGMA journal_mode = WAL")
        connection.executescript(SCHEMA)
        connection.commit()
