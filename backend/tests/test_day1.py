"""A 的第一天验收：FastAPI 可启动，SQLite 表已初始化，v0.1 契约可被检查。"""

import sqlite3

from fastapi.testclient import TestClient

from app.db import DATABASE_PATH, initialize_database
from app.main import app


def test_health_endpoint() -> None:
    """健康检查必须返回 ok，便于前端和部署脚本判断服务是否启动。"""
    with TestClient(app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "paper-companion-api",
        "version": "0.1.0",
    }


def test_openapi_contains_d1_health_contract() -> None:
    """FastAPI 应生成 OpenAPI 文档，且至少包含 D1 已实现的健康接口。"""
    with TestClient(app) as client:
        response = client.get("/openapi.json")

    assert response.status_code == 200
    assert "/health" in response.json()["paths"]


def test_database_has_core_and_extension_tables() -> None:
    """D1 先创建核心表和后续扩展表，保证后续成员可以直接开发。"""
    initialize_database()

    with sqlite3.connect(DATABASE_PATH) as connection:
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }

    assert {
        "books",
        "pages",
        "runs",
        "jobs",
        "book_classifications",
        "chapters",
        "book_entities",
        "reading_notes",
        "note_revisions",
        "note_shares",
    }.issubset(tables)


def test_database_enables_foreign_keys_and_wal() -> None:
    """数据库连接必须开启外键检查，初始化时切换到 WAL 日志模式。"""
    initialize_database()

    from app.db import get_connection

    with get_connection() as connection:
        foreign_keys = connection.execute("PRAGMA foreign_keys").fetchone()[0]
        journal_mode = connection.execute("PRAGMA journal_mode").fetchone()[0]

    assert foreign_keys == 1
    assert journal_mode.lower() == "wal"