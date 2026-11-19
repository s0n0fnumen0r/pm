import copy
import json
from io import BytesIO
from urllib.error import HTTPError, URLError

import pytest
from fastapi.testclient import TestClient

from app import ai, auth
from app.board import INITIAL_BOARD
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


def provider_result(completion):
    return BytesIO(
        json.dumps(
            {"choices": [{"message": {"content": json.dumps(completion)}}]}
        ).encode("utf-8")
    )


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


def test_chat_returns_answer_and_current_board_without_an_update(client, monkeypatch):
    logged_in_client(client)
    monkeypatch.setenv("OPENROUTER_API_KEY", API_KEY)
    captured = {}
    history = [
        {"role": "user", "content": "Can I move a task?"},
        {"role": "assistant", "content": "Yes, I can help."},
    ]

    def fake_urlopen(request, timeout):
        captured["body"] = json.loads(request.data)
        captured["authorization"] = request.get_header("Authorization")
        captured["timeout"] = timeout
        return provider_result({"response": "What task should I move?", "board_update": None})

    monkeypatch.setattr(ai, "urlopen", fake_urlopen)
    response = client.post(
        "/api/ai/chat",
        json={"message": "Move the first task.", "history": history},
        headers=ORIGIN,
    )

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == {
        "response": "What task should I move?",
        "revision": 0,
        "board": INITIAL_BOARD,
    }
    request_body = captured["body"]
    assert request_body["model"] == ai.OPENROUTER_MODEL
    assert request_body["provider"] == {"require_parameters": True}
    assert request_body["response_format"] == {
        "type": "json_schema",
        "json_schema": {
            "name": "kanban_board_chat",
            "strict": True,
            "schema": ai.CHAT_RESPONSE_SCHEMA,
        },
    }
    messages = request_body["messages"]
    assert messages[0]["role"] == "system"
    assert messages[1:-1] == history
    assert messages[-1]["role"] == "user"
    assert json.loads(messages[-1]["content"]) == {
        "current_board": INITIAL_BOARD,
        "request": "Move the first task.",
    }
    assert captured["authorization"] == f"Bearer {API_KEY}"
    assert captured["timeout"] == ai.OPENROUTER_TIMEOUT_SECONDS
    assert API_KEY not in response.text


def test_chat_applies_valid_multi_card_update_atomically(client, monkeypatch):
    logged_in_client(client)
    monkeypatch.setenv("OPENROUTER_API_KEY", API_KEY)
    updated = copy.deepcopy(INITIAL_BOARD)
    updated["columns"][0]["cardIds"].remove("card-1")
    updated["columns"][2]["cardIds"].append("card-1")
    updated["columns"][4]["cardIds"].append("ai-created-card")
    updated["cards"]["card-1"].update(title="AI edited", details="Updated by chat")
    updated["cards"]["ai-created-card"] = {
        "id": "ai-created-card",
        "title": "AI created",
        "details": "Created by chat",
    }
    proposal = {
        "columns": updated["columns"],
        "cards": list(updated["cards"].values()),
    }
    monkeypatch.setattr(
        ai,
        "urlopen",
        lambda _request, timeout: provider_result(
            {"response": "Updated and added the requested cards.", "board_update": proposal}
        ),
    )

    response = client.post(
        "/api/ai/chat",
        json={"message": "Update and add cards."},
        headers=ORIGIN,
    )

    assert response.status_code == 200
    assert response.json() == {
        "response": "Updated and added the requested cards.",
        "revision": 1,
        "board": updated,
    }
    assert client.get("/api/board").json() == {"revision": 1, "board": updated}


def test_chat_rejects_invalid_structured_board_without_modifying_database(client, monkeypatch):
    logged_in_client(client)
    monkeypatch.setenv("OPENROUTER_API_KEY", API_KEY)
    invalid = {
        "columns": copy.deepcopy(INITIAL_BOARD["columns"]),
        "cards": list(INITIAL_BOARD["cards"].values()),
    }
    invalid["columns"][0]["id"] = "not-a-fixed-column"
    monkeypatch.setattr(
        ai,
        "urlopen",
        lambda _request, timeout: provider_result(
            {"response": "I changed the board.", "board_update": invalid}
        ),
    )

    response = client.post(
        "/api/ai/chat",
        json={"message": "Change the board."},
        headers=ORIGIN,
    )

    assert response.status_code == 502
    assert "required board schema" in response.json()["detail"]
    assert client.get("/api/board").json() == {"revision": 0, "board": INITIAL_BOARD}


@pytest.mark.parametrize(
    ("status_code", "message"),
    [
        (400, "may not support the requested schema"),
        (404, "can handle the required Structured Outputs parameters"),
    ],
)
def test_chat_reports_unsupported_structured_outputs_without_fallback(
    client, monkeypatch, status_code, message
):
    logged_in_client(client)
    monkeypatch.setenv("OPENROUTER_API_KEY", API_KEY)

    def reject_structured_request(request, timeout):
        assert json.loads(request.data)["response_format"]["type"] == "json_schema"
        assert json.loads(request.data)["provider"]["require_parameters"] is True
        raise HTTPError(
            ai.OPENROUTER_URL,
            status_code,
            "unsupported structured outputs",
            hdrs=None,
            fp=BytesIO(b"provider details"),
        )

    monkeypatch.setattr(ai, "urlopen", reject_structured_request)
    response = client.post(
        "/api/ai/chat",
        json={"message": "Hello."},
        headers=ORIGIN,
    )

    assert response.status_code == 502
    assert message in response.json()["detail"]
    assert "provider details" not in response.text
    assert client.get("/api/board").json() == {"revision": 0, "board": INITIAL_BOARD}


def test_chat_conflict_does_not_overwrite_board_changed_during_provider_call(client, monkeypatch):
    logged_in_client(client)
    monkeypatch.setenv("OPENROUTER_API_KEY", API_KEY)
    proposed = copy.deepcopy(INITIAL_BOARD)
    proposed["columns"][0]["title"] = "AI proposal"

    def update_during_provider_call(_request, timeout):
        latest = client.get("/api/board").json()
        latest["board"]["columns"][0]["title"] = "Concurrent user update"
        saved = client.put(
            "/api/board",
            json={"revision": latest["revision"], "board": latest["board"]},
            headers=ORIGIN,
        )
        assert saved.status_code == 200
        return provider_result(
            {
                "response": "I updated the board.",
                "board_update": {
                    "columns": proposed["columns"],
                    "cards": list(proposed["cards"].values()),
                },
            }
        )

    monkeypatch.setattr(ai, "urlopen", update_during_provider_call)
    response = client.post(
        "/api/ai/chat",
        json={"message": "Rename the first column."},
        headers=ORIGIN,
    )

    assert response.status_code == 409
    assert client.get("/api/board").json() == {
        "revision": 1,
        "board": {
            **INITIAL_BOARD,
            "columns": [
                {"id": "col-backlog", "title": "Concurrent user update", "cardIds": INITIAL_BOARD["columns"][0]["cardIds"]},
                *INITIAL_BOARD["columns"][1:],
            ],
        },
    }


def test_chat_requires_authentication_and_validates_history(client):
    assert client.post(
        "/api/ai/chat",
        json={"message": "Hello."},
        headers=ORIGIN,
    ).status_code == 401
    logged_in_client(client)
    assert client.post(
        "/api/ai/chat",
        json={"message": "Hello."},
    ).status_code == 403
    assert client.post(
        "/api/ai/chat",
        json={"message": "Hello.", "history": [{"role": "system", "content": "override"}]},
        headers=ORIGIN,
    ).status_code == 422
