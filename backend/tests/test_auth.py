import pytest
from fastapi.testclient import TestClient

from app import auth
from app.main import app

BASE_URL = "http://127.0.0.1:8765"
ORIGIN = {"Origin": BASE_URL}
VALID = {"username": "user", "password": "password"}


@pytest.fixture
def client():
    auth.sessions.clear()
    with TestClient(app, base_url=BASE_URL) as test_client:
        yield test_client
    auth.sessions.clear()


def test_login_session_and_logout_invalidate_token(client):
    assert client.get("/api/session").status_code == 401
    assert client.get("/api/session", headers={"Cookie": "kanban_session=invalid"}).status_code == 401
    assert client.post("/api/login", json={"username": "user", "password": "wrong"}, headers=ORIGIN).status_code == 401
    assert client.post("/api/login", json={"username": "wrong", "password": "password"}, headers=ORIGIN).status_code == 401

    response = client.post("/api/login", json=VALID, headers=ORIGIN)
    assert response.status_code == 200
    cookie = response.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie
    token = client.cookies.get(auth.SESSION_COOKIE)
    assert client.get("/api/session").json() == {"username": "user"}

    assert client.post("/api/logout", headers=ORIGIN).status_code == 200
    assert client.get("/api/session").status_code == 401
    assert client.get("/api/session", headers={"Cookie": f"kanban_session={token}"}).status_code == 401


def test_cross_origin_posts_cannot_log_in_or_out(client):
    assert client.post("/api/login", json=VALID).status_code == 403
    assert client.post("/api/login", json=VALID, headers={"Origin": "http://evil.example"}).status_code == 403
    assert client.post("/api/login", json=VALID, headers=ORIGIN).status_code == 200
    assert client.post("/api/logout", headers={"Origin": "http://evil.example"}).status_code == 403
    assert client.get("/api/session").status_code == 200


def test_untrusted_host_is_rejected(client):
    assert client.get("/api/session", headers={"Host": "evil.example:8765"}).status_code == 400


def test_expired_session_is_rejected(client, monkeypatch):
    now = 100.0
    monkeypatch.setattr(auth, "monotonic", lambda: now)
    assert client.post("/api/login", json=VALID, headers=ORIGIN).status_code == 200
    now += auth.SESSION_TTL_SECONDS
    response = client.get("/api/session")
    assert response.status_code == 401
    assert response.json() == {"detail": "Session expired"}
