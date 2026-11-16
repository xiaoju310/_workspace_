"""Authentication: MongoDB sessions, with explicitly opted-in local legacy tokens."""
import hmac
import json
import os
from fastapi import Header, HTTPException
from .accounts import session_user


def actor_id(authorization: str | None = Header(default=None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "需要登录")
    token = authorization[7:]
    user = session_user(token) if os.getenv("AUTH_BACKEND") != "legacy" else None
    if user:
        return user["id"]
    # Legacy fixture tokens are disabled by default. Never enable on a public server.
    if os.getenv("ALLOW_LEGACY_TOKENS") == "1":
        try:
            users = json.loads(os.getenv("APP_USER_TOKENS", "{}"))
        except json.JSONDecodeError:
            raise HTTPException(503, "用户令牌配置无效")
        if isinstance(users, dict):
            for user_id, expected in users.items():
                if isinstance(user_id, str) and isinstance(expected, str) and expected and hmac.compare_digest(token, expected):
                    return user_id
    raise HTTPException(401, "登录已失效，请重新登录")


def require_owner(owner_id: str, actor: str) -> None:
    if owner_id != actor:
        raise HTTPException(404, "对象不存在")
