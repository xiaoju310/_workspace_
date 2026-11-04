"""本地演示用身份校验。未配置令牌时，私有接口一律拒绝。"""
import hmac
import json
import os
from fastapi import Depends, Header, HTTPException


def actor_id(authorization: str | None = Header(default=None)) -> str:
    """从环境变量配置的 bearer token 推出身份；绝不信任请求体中的 owner_id。"""
    try:
        users = json.loads(os.getenv("APP_USER_TOKENS", "{}"))
    except json.JSONDecodeError:
        raise HTTPException(503, "用户令牌配置无效")
    if not isinstance(users, dict) or not users:
        raise HTTPException(503, "未配置本地用户认证；私有接口已关闭")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "需要 Bearer 令牌")
    token = authorization[7:]
    for user, expected in users.items():
        if isinstance(user, str) and isinstance(expected, str) and expected and hmac.compare_digest(token, expected):
            return user
    raise HTTPException(401, "令牌无效")


def require_owner(owner_id: str, actor: str) -> None:
    if owner_id != actor:
        # 404 不泄露其他用户的对象是否存在。
        raise HTTPException(404, "对象不存在")
