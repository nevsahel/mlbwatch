"""Endpoint tests for the API's service and database health checks."""

from fastapi.testclient import TestClient

from backend.app.main import app


def test_health_endpoint():
    """The service health response includes an ISO-formatted UTC timestamp."""
    with TestClient(app) as client:
        response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["timestamp"].endswith("Z")


def test_database_health_endpoint():
    """The database health route succeeds when the configured database responds."""
    with TestClient(app) as client:
        response = client.get("/api/health/database")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
