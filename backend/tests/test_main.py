import re

from fastapi.testclient import TestClient

from app.main import MAX_BODY_BYTES, app

client = TestClient(app, base_url="http://127.0.0.1:8765")


def test_health_api():
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_security_headers_are_set():
    response = client.get("/api/health")

    assert response.headers["content-security-policy"] == "frame-ancestors 'none'"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["referrer-policy"] == "same-origin"


def test_oversized_request_bodies_are_rejected():
    declared = client.post("/api/login", content=b"x" * (MAX_BODY_BYTES + 1))
    assert declared.status_code == 413

    chunked = client.post("/api/login", content=iter([b"x" * MAX_BODY_BYTES, b"x"]))
    assert chunked.status_code == 413


def test_root_serves_exported_sign_in_and_static_asset():
    response = client.get("/")

    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "Checking your session" in response.text
    assert 'data-testid="column-col-backlog"' not in response.text
    asset = re.search(r'<script src="(/_next/static/[^"]+\.js)', response.text)
    assert asset is not None
    asset_response = client.get(asset.group(1))
    assert asset_response.status_code == 200
    assert "javascript" in asset_response.headers["content-type"]


def test_missing_api_route_is_not_served_as_the_page():
    response = client.get("/api/not-found")

    assert response.status_code == 404
    assert 'data-testid="column-col-backlog"' not in response.text
