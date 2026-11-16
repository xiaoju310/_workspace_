"""MongoDB-backed accounts and opaque, revocable sessions.

Business tables remain in SQLite during the staged migration. Never expose MongoDB itself.
"""
import hashlib
import os
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from functools import lru_cache

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError
from pymongo import ASCENDING, MongoClient
from pymongo.errors import DuplicateKeyError

PASSWORD_HASHER = PasswordHasher()
USERNAME = re.compile(r"^[a-zA-Z][a-zA-Z0-9_-]{2,31}$")


def utcnow():
    return datetime.now(timezone.utc)


@lru_cache(maxsize=1)
def mongo_client():
    return MongoClient(os.getenv("MONGODB_URI", "mongodb://127.0.0.1:27017"), serverSelectionTimeoutMS=3000)


def accounts_db():
    name = os.getenv("MONGODB_DATABASE", "paper_companion")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,63}", name):
        raise ValueError("Invalid MONGODB_DATABASE")
    return mongo_client()[name]


def initialize_accounts():
    mongo_client().admin.command("ping")
    db = accounts_db()
    db.users.create_index([("username", ASCENDING)], unique=True)
    db.sessions.create_index([("token_hash", ASCENDING)], unique=True)
    db.sessions.create_index([("expires_at", ASCENDING)], expireAfterSeconds=0)


def public_user(user):
    return {"id": user["_id"], "username": user["username"], "role": user["role"]}


def create_user(username: str, password: str, role: str = "user"):
    username = username.strip().lower()
    if not USERNAME.fullmatch(username):
        raise ValueError("用户名需为 3-32 位字母开头的字母、数字、下划线或连字符")
    if len(password) < 12 or len(password) > 256:
        raise ValueError("密码需为 12-256 个字符")
    if role not in {"user", "admin"}:
        raise ValueError("无效角色")
    user = {"_id": str(uuid.uuid4()), "username": username, "password_hash": PASSWORD_HASHER.hash(password),
            "role": role, "created_at": utcnow()}
    accounts_db().users.insert_one(user)
    return public_user(user)


def authenticate(username: str, password: str):
    user = accounts_db().users.find_one({"username": username.strip().lower()})
    # Equal-cost verification even for an unknown name, to limit account enumeration by timing.
    if user is None:
        try:
            PASSWORD_HASHER.verify(DUMMY_HASH, password)
        except VerificationError:
            pass
        return None
    try:
        if PASSWORD_HASHER.verify(user["password_hash"], password):
            return public_user(user)
    except VerificationError:
        pass
    return None


DUMMY_HASH = PASSWORD_HASHER.hash("not-a-real-user-password")


def issue_session(user_id: str):
    token = secrets.token_urlsafe(48)
    accounts_db().sessions.insert_one({"_id": str(uuid.uuid4()), "user_id": user_id,
        "token_hash": hashlib.sha256(token.encode()).hexdigest(), "expires_at": utcnow() + timedelta(days=7)})
    return token


def session_user(token: str):
    if not token or len(token) > 512:
        return None
    digest = hashlib.sha256(token.encode()).hexdigest()
    session = accounts_db().sessions.find_one({"token_hash": digest, "expires_at": {"$gt": utcnow()}})
    if session is None:
        return None
    user = accounts_db().users.find_one({"_id": session["user_id"]})
    return public_user(user) if user else None


def revoke_session(token: str):
    accounts_db().sessions.delete_one({"token_hash": hashlib.sha256(token.encode()).hexdigest()})
