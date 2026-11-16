"""Acceptance tests against the running local MongoDB using a disposable test database."""
import os
import uuid

import pytest
from fastapi.testclient import TestClient
from pymongo import MongoClient

from app import accounts, db
from app.main import app


@pytest.fixture()
def client(tmp_path, monkeypatch):
    name = "paper_companion_test_" + uuid.uuid4().hex
    monkeypatch.setenv("MONGODB_DATABASE", name)
    monkeypatch.delenv("AUTH_BACKEND", raising=False)
    monkeypatch.delenv("ALLOW_LEGACY_TOKENS", raising=False)
    monkeypatch.setattr(db, "DATABASE_PATH", tmp_path / "books.db")
    monkeypatch.setattr("app.main.DATA_ROOT", tmp_path / "data")
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        # Only delete the exact uniquely named disposable test database.
        accounts.mongo_client().drop_database(name)


def test_register_login_logout_and_book_isolation(client):
    password = "test-only-passphrase-strong"
    alice = client.post("/api/auth/register", json={"username": "Alice", "password": password})
    assert alice.status_code == 201
    assert alice.json()["user"]["role"] == "user"
    assert "password" not in str(alice.json()["user"])
    assert client.post("/api/auth/register", json={"username": "alice", "password": password}).status_code == 409
    assert client.post("/api/auth/login", json={"username": "alice", "password": "wrong-password-long"}).status_code == 401
    bob = client.post("/api/auth/register", json={"username": "bob", "password": password}).json()
    a_token = alice.json()["access_token"]
    b_token = bob["access_token"]
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {a_token}"}).json()["username"] == "alice"
    book = client.post("/api/books", headers={"Authorization": f"Bearer {a_token}"},
        json={"title": "My book", "authorization_ref": "self-created"})
    assert book.status_code == 201
    book_id = book.json()["id"]
    assert client.get(f"/api/books/{book_id}", headers={"Authorization": f"Bearer {b_token}"}).status_code == 404
    assert client.get(f"/api/books/{book_id}", headers={"Authorization": f"Bearer {a_token}"}).status_code == 200
    assert client.post("/api/auth/logout", headers={"Authorization": f"Bearer {a_token}"}).status_code == 204
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {a_token}"}).status_code == 401
    assert client.get(f"/api/books/{book_id}", headers={"Authorization": f"Bearer {a_token}"}).status_code == 401
    assert client.post("/api/auth/login", json={"username": "ALICE", "password": password}).status_code == 200


def test_user_cannot_self_register_as_admin_and_legacy_tokens_disabled(client, monkeypatch):
    monkeypatch.setenv("APP_USER_TOKENS", '{"owner-local":"test-secret"}')
    response = client.post("/api/auth/register", json={"username": "normal", "password": "secure-password-123", "role": "admin"})
    assert response.status_code == 201
    assert response.json()["user"]["role"] == "user"
    assert client.get("/api/auth/me", headers={"Authorization": "Bearer test-secret"}).status_code == 401
    assert client.post("/api/auth/register", json={"username": "x", "password": "short"}).status_code == 422
