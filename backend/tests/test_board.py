import copy
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from fastapi.testclient import TestClient

from app import auth
from app.board import INITIAL_BOARD
from app.database import connection, database_path, initialize_database
from app.main import app

BASE_URL = "http://127.0.0.1:8765"
ORIGIN = {"Origin": BASE_URL}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    auth.sessions.clear()
    app.dependency_overrides.clear()
    with TestClient(app, base_url=BASE_URL) as test_client:
        yield test_client
    app.dependency_overrides.clear()
    auth.sessions.clear()


def sign_in(client):
    response = client.post(
        "/api/login", json={"username": "user", "password": "password"}, headers=ORIGIN
    )
    assert response.status_code == 200


def collide_with_column_id(board):
    card = board["cards"].pop("card-1")
    card["id"] = "col-backlog"
    board["cards"]["col-backlog"] = card
    board["columns"][0]["cardIds"][0] = "col-backlog"


def test_authentication_and_origin_are_required(client):
    assert client.get("/api/board").status_code == 401
    assert client.put("/api/board", json={"revision": 0, "board": INITIAL_BOARD}, headers=ORIGIN).status_code == 401
    sign_in(client)
    assert client.put("/api/board", json={"revision": 0, "board": INITIAL_BOARD}).status_code == 403
    assert client.put(
        "/api/board", json={"revision": 0, "board": INITIAL_BOARD}, headers={"Origin": "http://evil.example"}
    ).status_code == 403
    assert client.get("/api/board").json()["revision"] == 0
    assert client.post("/api/logout", headers=ORIGIN).status_code == 200
    assert client.get("/api/board").status_code == 401


def test_board_operations_persist_and_empty_board_is_not_reseeded(client):
    sign_in(client)
    response = client.get("/api/board")
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == {"revision": 0, "board": INITIAL_BOARD}
    board = copy.deepcopy(response.json()["board"])
    columns = board["columns"]
    columns[0]["title"] = ""
    columns[0]["cardIds"] = ["card-2"]
    columns[1]["cardIds"] = ["new-card", "card-3", "card-1"]
    board["cards"]["card-1"].update(title="Edited", details="Updated details")
    board["cards"]["new-card"] = {"id": "new-card", "title": "New", "details": ""}
    columns[4]["cardIds"].remove("card-8")
    del board["cards"]["card-8"]
    response = client.put("/api/board", json={"revision": 0, "board": board}, headers=ORIGIN)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == {"revision": 1, "board": board}
    assert client.get("/api/board").json() == response.json()

    empty = copy.deepcopy(board)
    empty["cards"] = {}
    for column in empty["columns"]:
        column["cardIds"] = []
    assert client.put("/api/board", json={"revision": 1, "board": empty}, headers=ORIGIN).json() == {
        "revision": 2, "board": empty
    }
    assert client.post("/api/logout", headers=ORIGIN).status_code == 200
    sign_in(client)
    initialize_database()
    assert client.get("/api/board").json() == {"revision": 2, "board": empty}


@pytest.mark.parametrize(
    "change",
    [
        lambda board: board["columns"].reverse(),
        lambda board: board["columns"].pop(),
        lambda board: board["columns"][0]["cardIds"].append("card-1"),
        lambda board: board["columns"][0]["cardIds"].append("missing"),
        lambda board: board["columns"][0]["cardIds"].remove("card-1"),
        lambda board: board["cards"]["card-1"].update(id="different"),
        lambda board: board["cards"]["card-1"].update(title="  "),
        collide_with_column_id,
        lambda board: board["cards"]["card-1"].update(unexpected="field"),
    ],
)
def test_invalid_boards_do_not_change_data(client, change):
    sign_in(client)
    original = client.get("/api/board").json()
    board = copy.deepcopy(original["board"])
    change(board)
    assert client.put("/api/board", json={"revision": 0, "board": board}, headers=ORIGIN).status_code == 422
    assert client.get("/api/board").json() == original


@pytest.mark.parametrize("revision", [-1, True, "0", 9223372036854775807])
def test_invalid_revisions_are_rejected(client, revision):
    sign_in(client)
    assert client.put("/api/board", json={"revision": revision, "board": INITIAL_BOARD}, headers=ORIGIN).status_code == 422


def test_users_have_independent_boards(client):
    sign_in(client)
    original = client.get("/api/board").json()
    modified = copy.deepcopy(original["board"])
    modified["columns"][0]["title"] = "First user's board"
    assert client.put("/api/board", json={"revision": 0, "board": modified}, headers=ORIGIN).status_code == 200

    app.dependency_overrides[auth.require_user] = lambda: "another-user"
    assert client.get("/api/board").json() == original
    other = copy.deepcopy(original["board"])
    other["columns"][0]["title"] = "Second user's board"
    assert client.put("/api/board", json={"revision": 0, "board": other}, headers=ORIGIN).status_code == 200
    del app.dependency_overrides[auth.require_user]
    assert client.get("/api/board").json() == {"revision": 1, "board": modified}
    with connection() as db:
        assert db.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        assert db.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 2
        assert db.execute("SELECT COUNT(*) FROM boards").fetchone()[0] == 2
        first = db.execute("SELECT id, user_id FROM boards LIMIT 1").fetchone()
        with pytest.raises(sqlite3.IntegrityError):
            db.execute("INSERT INTO boards (id, user_id) VALUES (?, ?)", ("duplicate", first["user_id"]))
        with pytest.raises(sqlite3.IntegrityError):
            db.execute(
                "INSERT INTO cards VALUES (?, ?, ?, ?, ?, ?)",
                (first["id"], "invalid", "unknown-column", "Invalid", "", 0),
            )


def test_competing_updates_produce_one_success_and_one_conflict(client):
    sign_in(client)
    original = client.get("/api/board").json()
    token = client.cookies.get(auth.SESSION_COOKIE)
    barrier = Barrier(2)

    def save(title):
        board = copy.deepcopy(original["board"])
        board["columns"][0]["title"] = title
        with TestClient(app, base_url=BASE_URL) as concurrent_client:
            barrier.wait(timeout=10)
            return concurrent_client.put(
                "/api/board",
                json={"revision": 0, "board": board},
                headers={**ORIGIN, "Cookie": f"{auth.SESSION_COOKIE}={token}"},
            )

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(save, ["first", "second"]))
    assert sorted(response.status_code for response in responses) == [200, 409]
    winner = next(response.json() for response in responses if response.status_code == 200)
    assert client.get("/api/board").json() == winner
    assert winner["revision"] == 1


def test_database_error_rolls_back_the_whole_update(client):
    sign_in(client)
    original = client.get("/api/board").json()
    with connection() as db:
        db.execute("""CREATE TRIGGER reject_test_card BEFORE INSERT ON cards
                      WHEN NEW.id = 'fail'
                      BEGIN SELECT RAISE(ABORT, 'test failure'); END""")
    changed = copy.deepcopy(original["board"])
    changed["columns"][0]["title"] = "Must roll back"
    changed["columns"][0]["cardIds"].append("fail")
    changed["cards"]["fail"] = {"id": "fail", "title": "New", "details": ""}
    with pytest.raises(sqlite3.IntegrityError, match="test failure"):
        client.put("/api/board", json={"revision": 0, "board": changed}, headers=ORIGIN)
    assert client.get("/api/board").json() == original


def test_initialization_rejects_unsupported_versions(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    initialize_database()
    with connection() as db:
        db.execute("PRAGMA user_version = 999")
    with pytest.raises(RuntimeError, match="Unsupported database schema version: 999"):
        initialize_database()
    with sqlite3.connect(database_path()) as db:
        assert db.execute("PRAGMA user_version").fetchone()[0] == 999
