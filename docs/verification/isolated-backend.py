"""仅用于验证：临时数据库/素材目录，随机测试令牌由调用者传入。"""
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

import uvicorn

repo = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(repo / "backend"))
if not os.environ.get("APP_USER_TOKENS"):
    raise RuntimeError("验证程序必须提供一次性测试令牌")
with TemporaryDirectory(prefix="paper-companion-api-") as temp:
    os.environ["DATABASE_PATH"] = str(Path(temp) / "test.db")
    os.environ["DATA_ROOT"] = str(Path(temp) / "data")
    from app.main import app
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("VERIFY_API_PORT", "18765")), access_log=False, log_level="warning")
