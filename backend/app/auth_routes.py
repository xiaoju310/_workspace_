"""Public registration and login, current account, and revocable logout."""
import threading
import time
from collections import defaultdict, deque

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError

from .accounts import authenticate, create_user, issue_session, revoke_session, session_user

router = APIRouter(prefix="/api/auth", tags=["auth"])
_attempts = defaultdict(deque)
_lock = threading.Lock()


class Credentials(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=12, max_length=256)


def limit(request: Request):
    # Only trust the direct peer, not user-supplied X-Forwarded-For.
    address = request.client.host if request.client else "unknown"
    now = time.monotonic()
    with _lock:
        times = _attempts[address]
        while times and times[0] < now - 60:
            times.popleft()
        if len(times) >= 12:
            raise HTTPException(429, "操作过于频繁，请稍后再试")
        times.append(now)


def signed_in(authorization: str | None = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "需要登录")
    user = session_user(authorization[7:])
    if user is None:
        raise HTTPException(401, "登录已失效")
    return user


@router.post("/register", status_code=201, dependencies=[Depends(limit)])
def register(credentials: Credentials):
    try:
        user = create_user(credentials.username, credentials.password)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except DuplicateKeyError as exc:
        raise HTTPException(409, "用户名已被使用") from exc
    return {"user": user, "access_token": issue_session(user["id"]), "token_type": "bearer"}


@router.post("/login", dependencies=[Depends(limit)])
def login(credentials: Credentials):
    user = authenticate(credentials.username, credentials.password)
    if user is None:
        raise HTTPException(401, "用户名或密码错误")
    return {"user": user, "access_token": issue_session(user["id"]), "token_type": "bearer"}


@router.get("/me")
def me(user: dict = Depends(signed_in)):
    return user


@router.post("/logout", status_code=204)
def logout(authorization: str | None = Header(default=None), user: dict = Depends(signed_in)):
    revoke_session(authorization[7:])
