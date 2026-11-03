"""FastAPI 应用入口。

第一天目标：先建立一个能启动、能自检的后端骨架，
后续成员可以在这个入口上继续添加上传、解析和生成接口。
"""

from fastapi import FastAPI

from .db import initialize_database

# title/version 会显示在自动生成的接口文档 /docs 中，便于团队联调。
app = FastAPI(title="纸书智伴 API", version="0.1.0")


@app.on_event("startup")
def on_startup() -> None:
    """应用启动时初始化 SQLite 表。

    这里故意使用幂等初始化：重复启动不会删除已有数据，
    也不会要求开发者手动执行建表 SQL。
    """

    initialize_database()


@app.get("/health", tags=["system"])
def health_check() -> dict[str, str]:
    """返回最小健康状态，供前端、部署脚本和人工检查使用。"""

    return {"status": "ok", "service": "paper-companion-api", "version": "0.1.0"}
