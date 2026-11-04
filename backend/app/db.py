"""SQLite 数据库连接、初始化和轻量迁移。"""

import os
import sqlite3
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATABASE_PATH = Path(os.getenv("DATABASE_PATH", str(PROJECT_ROOT / "data" / "paper_companion.db")))

SCHEMA = """
CREATE TABLE IF NOT EXISTS books (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    authorization_ref TEXT NOT NULL,
    owner_id TEXT NOT NULL DEFAULT 'owner-local',
    status TEXT NOT NULL DEFAULT 'IMPORTED',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pages (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    page_no INTEGER NOT NULL,
    image_path TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    ocr_json TEXT,
    vision_json TEXT,
    revision INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE(book_id, page_no)
);
CREATE TABLE IF NOT EXISTS page_revisions (
    id TEXT PRIMARY KEY,
    page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL,
    editor_id TEXT NOT NULL,
    ocr_json TEXT,
    vision_json TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(page_id, revision)
);
CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    config_json TEXT NOT NULL,
    model_manifest_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    finished_at TEXT
);
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    run_id TEXT REFERENCES runs(id) ON DELETE CASCADE,
    stage TEXT NOT NULL,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    error_code TEXT,
    error_message TEXT,
    started_at TEXT,
    ended_at TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS book_classifications (
    book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
    predicted_type TEXT NOT NULL,
    confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
    reasons_json TEXT NOT NULL,
    confirmed_type TEXT,
    confirmed_by TEXT,
    confirmed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chapters (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    chapter_no INTEGER NOT NULL,
    title TEXT,
    start_page_no INTEGER,
    end_page_no INTEGER,
    content_json TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(book_id, chapter_no)
);
CREATE TABLE IF NOT EXISTS book_entities (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL,
    name TEXT NOT NULL,
    attributes_json TEXT,
    source_json TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reading_notes (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    owner_id TEXT NOT NULL,
    content_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT',
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS note_revisions (
    id TEXT PRIMARY KEY,
    note_id TEXT NOT NULL REFERENCES reading_notes(id) ON DELETE CASCADE,
    editor_id TEXT NOT NULL,
    content_json TEXT NOT NULL,
    version INTEGER NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS note_shares (
    id TEXT PRIMARY KEY,
    note_id TEXT NOT NULL REFERENCES reading_notes(id) ON DELETE CASCADE,
    owner_id TEXT NOT NULL,
    share_mode TEXT NOT NULL CHECK(share_mode IN ('invite_only', 'link')),
    shared_user_id TEXT,
    token_hash TEXT,
    expires_at TEXT,
    revoked_at TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS media_assets (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    asset_type TEXT NOT NULL,
    file_path TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    duration_ms INTEGER,
    metadata_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS segments (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    page_no INTEGER,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    caption TEXT,
    source_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS interactions (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    interaction_type TEXT NOT NULL,
    input_json TEXT NOT NULL,
    output_json TEXT NOT NULL,
    latency_ms INTEGER,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS run_logs (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    level TEXT NOT NULL,
    event TEXT NOT NULL,
    safe_metadata_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);
"""


def get_connection() -> sqlite3.Connection:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def _add_missing_columns(connection: sqlite3.Connection) -> None:
    """给 D1 已存在的本地数据库补列，不删除任何历史数据。"""
    migrations = {
        "books": {
            "owner_id": "TEXT NOT NULL DEFAULT 'owner-local'",
            "status": "TEXT NOT NULL DEFAULT 'IMPORTED'",
            "updated_at": "TEXT NOT NULL DEFAULT ''",
        },
        "pages": {
            "mime_type": "TEXT NOT NULL DEFAULT 'image/jpeg'",
            "size_bytes": "INTEGER NOT NULL DEFAULT 0",
        },
        "jobs": {
            "max_attempts": "INTEGER NOT NULL DEFAULT 3",
            "error_message": "TEXT",
        },
    }
    for table, columns in migrations.items():
        current = {row[1] for row in connection.execute(f"PRAGMA table_info({table})")}
        for name, declaration in columns.items():
            if name not in current:
                connection.execute(f"ALTER TABLE {table} ADD COLUMN {name} {declaration}")
    connection.execute("UPDATE books SET updated_at = created_at WHERE updated_at = ''")


def initialize_database() -> None:
    with get_connection() as connection:
        connection.execute("PRAGMA journal_mode = WAL")
        connection.executescript(SCHEMA)
        _add_missing_columns(connection)
        # 进程重启后内存后台任务已丢失：不允许排队/运行/重试状态继续误报为进行中。
        connection.execute("UPDATE jobs SET status='FAILED', error_code='INTERRUPTED', error_message='服务重启中断任务', ended_at=datetime('now') WHERE status IN ('QUEUED','RUNNING','RETRYING')")
        connection.execute("UPDATE runs SET status='FAILED', finished_at=datetime('now') WHERE status IN ('QUEUED','RUNNING','RETRYING')")
        connection.commit()
