"""测试第一天的健康检查和数据库初始化。"""

from fastapi.testclient import TestClient

from app.db import DATABASE_PATH, initialize_database
from app.main import app


def test_health_endpoint() -> None:
    """/health 应返回可供监控判断的 ok 状态。"""

    with TestClient(app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_database_has_core_tables() -> None:
    """初始化后，四张核心表都应该存在。"""

    initialize_database()
    import sqlite3

    with sqlite3.connect(DATABASE_PATH) as connection:
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }

    assert {"books", "pages", "runs", "jobs"}.issubset(tables)
