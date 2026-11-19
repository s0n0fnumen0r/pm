import json
from io import BytesIO
from urllib.error import HTTPError, URLError

import pytest
from fastapi.testclient import TestClient

from app import ai, auth
from app.main import app

BASE_URL = "http://127.0.0.1:8765"
ORIGIN = {"Origin": BASE_URL}
VALID = {"username": "user", "password": "password"}
API_KEY = "test-openrouter-key"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    auth.sessions.clear()
    with TestClient(app, base_url=BASE_URL) as test_client:
        yield test_client
    auth.sessions.clear()


def logged_in_client(client):
    response = client.post("/api/login", json=VALID, headers=ORIGIN)
    assert response.status_code == 200
    return client


def test_connectivity_check_requires_authentication_and_same_origin(client):
    assert client.post("/api/ai/check", headers=ORIGIN).status_code == 401

    logged_in_client(client)
    assert client.post("/api/ai/check").status_code == 403
    assert client.post(
        "/api/ai/check",
        headers={"Origin": "http://evil.example"},
    ).status_code == 403


def test_connectivity_check_sends_server_key_and_returns_answer(client, monkeypatch):
    logged_in_client(client)
    monkeypatch.setenv("OPENROUTER_API_KEY", API_KEY)
    calls = []

    def fake_urlopen(request, timeout):
        calls.append((request, timeout))
        return BytesIO(
            json.dumps(
                {"choices": [{"message": {"content": "4"}}]}
            ).encode("utf-8")
        )

    monkeypatch.setattr(ai, "urlopen", fake_urlopen)
    response = client.post("/api/ai/check", headers=ORIGIN)

    assert response.status_code == 200
    assert response.json() == {"answer": "4", "model": ai.OPENROUTER_MODEL}
    assert response.headers["cache-control"] == "no-store"
    request, timeout = calls[0]
    assert request.full_url == ai.OPENROUTER_URL
    assert request.get_header("Authorization") == f"Bearer {API_KEY}"
    assert json.loads(request.data) == {
        "model": ai.OPENROUTER_MODEL,
        "messages": [
            {
                "role": "user",
                "content": "What is 2 + 2? Reply with only the single character 4.",
            }
        ],
    }
    assert timeout == ai.OPENROUTER_TIMEOUT_SECONDS
    assert API_KEY not in response.text


def test_connectivity_check_reports_missing_configuration(client, monkeypatch):
    logged_in_client(client)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

    response = client.post("/api/ai/check", headers=ORIGIN)

    assert response.status_code == 503
    assert "OPENROUTER_API_KEY" in response.json()["detail"]


def test_connectivity_check_reports_network_failure_without_provider_details(client, monkeypatch):
    logged_in_client(client)
    monkeypatch.setenv("OPENROUTER_API_KEY", API_KEY)

    def fail_urlopen(_request, timeout):
        raise URLError("connection failed")

    monkeypatch.setattr(ai, "urlopen", fail_urlopen)
    response = client.post("/api/ai/check", headers=ORIGIN)

    assert response.status_code == 502
    assert "network connectivity" in response.json()["detail"]
    assert API_KEY not in response.text


@pytest.mark.parametrize(
    ("status_code", "message"),
    [
        (401, "rejected the API key"),
        (404, ai.OPENROUTER_MODEL),
        (429, "quota"),
    ],
)
def test_connectivity_check_surfaces_provider_and_model_failures(
    client, monkeypatch, status_code, message
):
    logged_in_client(client)
    monkeypatch.setenv("OPENROUTER_API_KEY", API_KEY)

    def fail_urlopen(_request, timeout):
        raise HTTPError(
            ai.OPENROUTER_URL,
            status_code,
            "provider failure",
            hdrs=None,
            fp=BytesIO(b'{"error":{"message":"provider response"}}'),
        )

    monkeypatch.setattr(ai, "urlopen", fail_urlopen)
    response = client.post("/api/ai/check", headers=ORIGIN)

    assert response.status_code == 502
    assert message in response.json()["detail"]
    assert "provider response" not in response.text
    assert API_KEY not in response.text


def test_connectivity_check_rejects_an_unexpected_model_answer(client, monkeypatch):
    logged_in_client(client)
    monkeypatch.setenv("OPENROUTER_API_KEY", API_KEY)
    monkeypatch.setattr(
        ai,
        "urlopen",
        lambda _request, timeout: BytesIO(
            json.dumps({"choices": [{"message": {"content": "5"}}]}).encode("utf-8")
        ),
    )

    response = client.post("/api/ai/check", headers=ORIGIN)

    assert response.status_code == 502
    assert ai.OPENROUTER_MODEL in response.json()["detail"]
