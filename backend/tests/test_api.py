from fastapi.testclient import TestClient

from backend.app.main import app


def test_health_endpoint():
    with TestClient(app) as client:
        response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["timestamp"].endswith("Z")


def test_database_health_endpoint():
    with TestClient(app) as client:
        response = client.get("/api/health/database")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
