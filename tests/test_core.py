import io
import json

import pytest
from fastapi.testclient import TestClient
from PIL import Image

import backend.database as database
import backend.main as main
from backend.imaging import open_photo, quality_report
from backend.species import load_model


def image_bytes(size=(900, 600), color=(80, 140, 155)):
    output = io.BytesIO()
    Image.new("RGB", size, color).save(output, "JPEG")
    return output.getvalue()


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(database, "DATA", tmp_path)
    monkeypatch.setattr(database, "DATABASE_URL", "")
    monkeypatch.setattr(main, "MODEL", tmp_path / "species_model.json")
    with TestClient(main.app) as test_client:
        yield test_client


def register(client, email):
    response = client.post("/api/auth/register", headers={"X-Reef-Request": "1"}, json={
        "email": email, "name": "Researcher", "password": "a-secure-passphrase-123",
    })
    assert response.status_code == 201, response.text


def test_measurement_ratio_is_calibrated():
    calibration = main.Calibration(ruler=((0.1, 0.5), (0.3, 0.5)), fish=((0.1, 0.4), (0.7, 0.4)), ruler_cm=10, coplanar=True)
    assert main.estimate_length(calibration, (1000, 500)) == 30.0


def test_invalid_model_schema_is_rejected(tmp_path):
    model = tmp_path / "species_model.json"
    model.write_text('{"feature_version": 2, "labels": ["Only one"], "centroids": [[]]}')
    with pytest.raises(ValueError, match="labels"):
        load_model(model)


def test_quality_report_and_invalid_upload(client):
    register(client, "quality@example.com")
    health = client.get("/api/health")
    assert health.status_code == 200
    assert health.json() == {"status": "ok"}
    assert health.headers["x-content-type-options"] == "nosniff"
    assert health.headers["x-frame-options"] == "DENY"
    prepared = client.post("/api/photos/prepare", headers={"X-Reef-Request": "1"},
        files={"file": ("catch.jpg", image_bytes(), "image/jpeg")})
    assert prepared.status_code == 200
    assert prepared.headers["content-type"] == "image/jpeg"
    quality = client.post("/api/photos/quality", headers={"X-Reef-Request": "1"},
        files={"file": ("catch.jpg", prepared.content, "image/jpeg")})
    assert quality.status_code == 200
    assert quality.json()["width"] == 900
    assert quality.json()["height"] == 600
    conservation = client.post("/api/chat", headers={"X-Reef-Request": "1"},
        json={"message": "How should I monitor coastal fish habitat in Pakistan?"})
    assert conservation.status_code == 200
    assert conservation.json()["intent"] == "habitat_health"
    assert "repeatable sites" in conservation.json()["answer"]
    assert "You have no saved catches yet" not in conservation.json()["answer"]
    protected = client.post("/api/chat", headers={"X-Reef-Request": "1"},
        json={"message": "What should I do with a protected species?"})
    assert protected.json()["intent"] == "protected_species"
    assert "local authority" in protected.json()["answer"]
    thanks = client.post("/api/chat", headers={"X-Reef-Request": "1"}, json={"message": "Thank you so much!"})
    assert thanks.json()["intent"] == "thanks"
    assert thanks.json()["answer"].startswith("You’re welcome")
    assert thanks.json()["evidence"] is None
    assert thanks.json()["follow_ups"] == []
    natural = client.post("/api/chat", headers={"X-Reef-Request": "1"}, json={"message": "thx"})
    assert natural.json()["intent"] == "thanks"
    informal = client.post("/api/chat", headers={"X-Reef-Request": "1"}, json={"message": "thank u, that helped"})
    assert informal.json()["intent"] == "thanks"
    greeting = client.post("/api/chat", headers={"X-Reef-Request": "1"}, json={"message": "Hello there!"})
    assert greeting.json()["intent"] == "greeting"
    totals = client.post("/api/chat", headers={"X-Reef-Request": "1"}, json={"message": "Do I have any catches saved?"})
    assert totals.json()["intent"] == "totals"
    assert "0 fish" in totals.json()["answer"]
    unknown = client.post("/api/chat", headers={"X-Reef-Request": "1"}, json={"message": "Can we discuss this idea?"})
    assert unknown.json()["intent"] == "help"
    assert "which part" in unknown.json()["answer"]
    follow_up = client.post("/api/chat", headers={"X-Reef-Request": "1"}, json={
        "message": "Tell me more",
        "history": [{"role": "assistant", "content": conservation.json()["answer"], "intent": "habitat_health"}],
    })
    assert follow_up.json()["intent"] == "habitat_health"
    assert "repeatable sites" in follow_up.json()["answer"]
    troubleshooting = client.post("/api/chat", headers={"X-Reef-Request": "1"}, json={"message": "My upload is not working"})
    assert troubleshooting.json()["intent"] == "troubleshooting"
    assert "Which step" in troubleshooting.json()["answer"]
    report = quality_report(open_photo(image_bytes()))
    assert report["method"] == "capture_quality_v1"
    field_size = quality_report(open_photo(image_bytes((725, 483))))
    assert not any("resolution" in warning.casefold() for warning in field_size["warnings"])
    very_small = quality_report(open_photo(image_bytes((320, 240))))
    assert any("still accepted" in warning for warning in very_small["warnings"])
    response = client.post("/api/photos/prepare", headers={"X-Reef-Request": "1"}, files={"file": ("bad.txt", b"not an image", "text/plain")})
    assert response.status_code == 422


def test_persistence_ownership_review_and_export(client, monkeypatch):
    register(client, "owner@example.com")
    assert client.post("/api/auth/logout", headers={"X-Reef-Request": "1"}).status_code == 204
    assert client.get("/api/catches").status_code == 401
    login = client.post("/api/auth/login", headers={"X-Reef-Request": "1"}, json={
        "email": "owner@example.com", "password": "a-secure-passphrase-123",
    })
    assert login.status_code == 200
    avatar = client.post("/api/auth/avatar", headers={"X-Reef-Request": "1"},
        files={"file": ("avatar.png", image_bytes((500, 700)), "image/png")})
    assert avatar.status_code == 200
    assert avatar.json()["user"]["has_avatar"] is True
    assert client.get("/api/auth/avatar").headers["content-type"] == "image/jpeg"
    changed = client.post("/api/auth/change-password", headers={"X-Reef-Request": "1"}, json={
        "current_password": "a-secure-passphrase-123", "new_password": "a-new-secure-passphrase-456",
    })
    assert changed.status_code == 200
    metadata = {
        "collected_on": "2026-11-11", "site": "PK-SD-01", "context": "Survey",
        "habitat": "Marine", "water_body": "Arabian Sea", "gear": "visual survey",
        "group": "trip-01", "notes": "test record", "demo": True,
        "specimens": [{"species": "Unknown / Needs review", "calibration": None, "measured_cm": None, "weight_g": None, "crop": None}],
    }
    created = client.post("/api/catches", headers={"X-Reef-Request": "1"},
        files={"file": ("catch.jpg", image_bytes(), "image/jpeg")}, data={"metadata": json.dumps(metadata)})
    assert created.status_code == 201, created.text
    catch_id = created.json()["id"]
    first_page = client.get("/api/catches?limit=1&offset=0&sort=oldest")
    assert first_page.status_code == 200
    assert first_page.headers["x-total-count"] == "1"
    assert len(first_page.json()) == 1
    assert client.get("/api/catches?limit=1&offset=1").json() == []
    blank_review = client.patch(f"/api/catches/{catch_id}/fish/1/review", headers={"X-Reef-Request": "1"},
        json={"species": "   ", "reviewed_length_cm": 31.2})
    assert blank_review.status_code == 422
    annotation = client.patch(f"/api/catches/{catch_id}/fish/1/annotation", headers={"X-Reef-Request": "1"}, json={
        "calibration": {"ruler": [[0.1, 0.5], [0.3, 0.5]], "fish": [[0.1, 0.4], [0.7, 0.4]],
                        "ruler_cm": 10, "coplanar": True},
        "crop": None,
    })
    assert annotation.status_code == 200
    assert annotation.json()["specimens"][0]["estimated_cm"] == 30.0
    reviewed = client.patch(f"/api/catches/{catch_id}/fish/1/review", headers={"X-Reef-Request": "1"},
        json={"species": "Rastrelliger kanagurta", "reviewed_length_cm": 31.2})
    assert reviewed.status_code == 200
    assert reviewed.json()["specimens"][0]["species"] == "Rastrelliger kanagurta"
    replaced_photo = client.put(f"/api/catches/{catch_id}/photo", headers={"X-Reef-Request": "1"},
        files={"file": ("replacement.jpg", image_bytes((1000, 700), (40, 110, 160)), "image/jpeg")})
    assert replaced_photo.status_code == 200
    assert replaced_photo.json()["image_width"] == 1000
    assert replaced_photo.json()["specimens"][0]["estimated_cm"] is None
    assert replaced_photo.json()["specimens"][0]["measured_cm"] == 31.2
    assert replaced_photo.json()["specimens"][0]["species"] == "Rastrelliger kanagurta"
    chat = client.post("/api/chat", headers={"X-Reef-Request": "1"}, json={"message": "How many fish have I recorded?"})
    assert chat.status_code == 200
    assert "1 fish" in chat.json()["answer"]
    assert chat.json()["intent"] == "totals"
    assert chat.json()["evidence"] == {"catch_records": 1, "specimens": 1}
    assert chat.json()["activity"]
    assert chat.json()["follow_ups"]
    exported = client.get("/api/export.csv").text
    assert "Rastrelliger kanagurta" in exported
    assert "demo" in exported.splitlines()[0]
    assert "review_status" in exported.splitlines()[0]
    assert ",True," in exported

    updated = client.patch(f"/api/catches/{catch_id}", headers={"X-Reef-Request": "1"}, json={
        "collected_on": "2026-11-10", "site": "PK-SD-EDITED", "context": "Fish market",
        "habitat": "Marine", "water_body": "Arabian Sea", "gear": "handline", "group": "trip-02",
        "notes": "corrected metadata", "demo": False,
    })
    assert updated.status_code == 200
    assert updated.json()["site"] == "PK-SD-EDITED"
    assert updated.json()["specimens"][0]["species"] == "Rastrelliger kanagurta"
    assert client.get(f"/api/catches/{catch_id}").json()["demo"] is False

    monkeypatch.setenv("REEF_DEV_SHOW_RESET_TOKEN", "1")
    recovery = client.post("/api/auth/forgot-password", headers={"X-Reef-Request": "1"}, json={"email": "owner@example.com"})
    assert recovery.status_code == 200
    reset_token = recovery.json()["development_token"]
    reset = client.post("/api/auth/reset-password", headers={"X-Reef-Request": "1"}, json={
        "token": reset_token, "new_password": "a-third-secure-passphrase-789",
    })
    assert reset.status_code == 200
    assert client.get("/api/catches").status_code == 401
    assert client.post("/api/auth/reset-password", headers={"X-Reef-Request": "1"}, json={
        "token": reset_token, "new_password": "a-fourth-secure-passphrase-000",
    }).status_code == 400
    assert client.post("/api/auth/login", headers={"X-Reef-Request": "1"}, json={
        "email": "owner@example.com", "password": "a-third-secure-passphrase-789",
    }).status_code == 200

    other = TestClient(main.app)
    register(other, "other@example.com")
    assert other.get(f"/api/catches/{catch_id}").status_code == 404
    assert other.delete(f"/api/catches/{catch_id}", headers={"X-Reef-Request": "1"}).status_code == 404
    removed_account = other.request("DELETE", "/api/auth/account", headers={"X-Reef-Request": "1"}, json={
        "current_password": "a-secure-passphrase-123", "confirmation": "DELETE",
    })
    assert removed_account.status_code == 204
    assert other.get("/api/auth/session").json()["user"] is None
    other.close()
    deleted = client.delete(f"/api/catches/{catch_id}", headers={"X-Reef-Request": "1"})
    assert deleted.status_code == 204
    assert client.get(f"/api/catches/{catch_id}").status_code == 404
