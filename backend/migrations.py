"""Small, dependency-free, forward-only SQLite migrations.

The application keeps the original ``catches`` JSON and photo columns as the
lossless source of truth.  New relational tables index research entities and
provenance without rewriting or deleting existing records.
"""

import json
from datetime import datetime, timezone
from uuid import uuid4


MIGRATIONS: list[tuple[int, str]] = [
    (1, """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
            salt BLOB NOT NULL, password_hash BLOB NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token_hash BLOB PRIMARY KEY NOT NULL,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
        CREATE TABLE IF NOT EXISTS auth_attempts (
            client TEXT NOT NULL, window INTEGER NOT NULL, attempts INTEGER NOT NULL,
            PRIMARY KEY (window, client)
        );
        CREATE TABLE IF NOT EXISTS catches (
            id TEXT PRIMARY KEY, created_at TEXT NOT NULL, details TEXT NOT NULL,
            photo BLOB NOT NULL, owner_id INTEGER REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS catches_owner_date ON catches(owner_id, created_at DESC);
    """),
    (2, """
        ALTER TABLE catches ADD COLUMN demo INTEGER NOT NULL DEFAULT 0;
        CREATE TABLE IF NOT EXISTS species (
            id INTEGER PRIMARY KEY, scientific_name TEXT NOT NULL UNIQUE,
            common_name TEXT NOT NULL DEFAULT '', region TEXT NOT NULL DEFAULT '',
            identification_supported INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS model_versions (
            id TEXT PRIMARY KEY, feature_version INTEGER NOT NULL,
            labels_json TEXT NOT NULL, metrics_json TEXT,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS fish (
            id TEXT PRIMARY KEY, catch_id TEXT NOT NULL REFERENCES catches(id) ON DELETE CASCADE,
            ordinal INTEGER NOT NULL, reviewed_species TEXT NOT NULL,
            review_status TEXT NOT NULL DEFAULT 'unreviewed',
            UNIQUE(catch_id, ordinal)
        );
        CREATE INDEX IF NOT EXISTS fish_catch ON fish(catch_id, ordinal);
        CREATE TABLE IF NOT EXISTS predictions (
            id INTEGER PRIMARY KEY, fish_id TEXT NOT NULL REFERENCES fish(id) ON DELETE CASCADE,
            model_id TEXT, predicted_species TEXT NOT NULL, candidates_json TEXT NOT NULL,
            evidence_score REAL, needs_review INTEGER NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS measurements (
            id INTEGER PRIMARY KEY, fish_id TEXT NOT NULL REFERENCES fish(id) ON DELETE CASCADE,
            method TEXT NOT NULL, estimated_cm REAL, physical_cm REAL, error_cm REAL,
            calibration_json TEXT, perspective_ok INTEGER NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS reviews (
            id INTEGER PRIMARY KEY, fish_id TEXT NOT NULL REFERENCES fish(id) ON DELETE CASCADE,
            reviewer_id INTEGER NOT NULL REFERENCES users(id), species TEXT NOT NULL,
            reviewed_length_cm REAL, endpoints_json TEXT, created_at TEXT NOT NULL
        );
    """),
    (3, """
        ALTER TABLE users ADD COLUMN avatar BLOB;
        ALTER TABLE users ADD COLUMN avatar_updated_at TEXT;
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
            token_hash BLOB PRIMARY KEY NOT NULL,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at INTEGER NOT NULL, used_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS password_reset_expiry ON password_reset_tokens(expires_at);
    """),
    (4, """
        CREATE INDEX IF NOT EXISTS catches_owner_demo ON catches(owner_id, demo);
    """),
]


def _has_column(db, table: str, column: str) -> bool:
    return column in {row[1] for row in db.execute(f"PRAGMA table_info({table})")}


def _backfill_research_tables(db) -> None:
    now = datetime.now(timezone.utc).isoformat()
    for catch_id, details in db.execute("SELECT id, details FROM catches"):
        record = json.loads(details)
        for ordinal, specimen in enumerate(record.get("specimens", []), 1):
            fish_id = f"{catch_id}:{ordinal}"
            species = specimen.get("species") or "Unknown / Needs review"
            status = "reviewed" if species not in {"Unknown", "Unknown / Needs review"} else "unreviewed"
            db.execute(
                "INSERT OR IGNORE INTO fish VALUES (?, ?, ?, ?, ?)",
                (fish_id, catch_id, ordinal, species, status),
            )
            suggestion = specimen.get("model_suggestion")
            if suggestion and not db.execute("SELECT 1 FROM predictions WHERE fish_id = ?", (fish_id,)).fetchone():
                candidates = suggestion.get("candidates") or [{"species": suggestion.get("species"), "distance": suggestion.get("distance")}]
                db.execute(
                    "INSERT INTO predictions (fish_id, model_id, predicted_species, candidates_json, evidence_score, needs_review, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (fish_id, suggestion.get("model_id"), suggestion.get("species") or "Unknown / Needs review",
                     json.dumps(candidates), suggestion.get("distance"), int(suggestion.get("needs_review", False)), now),
                )
            calibration = specimen.get("calibration")
            if (calibration or specimen.get("measured_cm") is not None) and not db.execute(
                "SELECT 1 FROM measurements WHERE fish_id = ?", (fish_id,)
            ).fetchone():
                db.execute(
                    "INSERT INTO measurements (fish_id, method, estimated_cm, physical_cm, error_cm, calibration_json, perspective_ok, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (fish_id, "ruler_ratio_v1" if calibration else "physical_measurement",
                     specimen.get("estimated_cm"), specimen.get("measured_cm"), specimen.get("error_cm"),
                     json.dumps(calibration) if calibration else None, int(bool(calibration and calibration.get("coplanar"))), now),
                )


def apply_migrations(db) -> None:
    if getattr(db, "is_postgres", False):
        apply_postgres_schema(db)
        return
    db.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)")
    applied = {row[0] for row in db.execute("SELECT version FROM schema_migrations")}
    for version, sql in MIGRATIONS:
        if version in applied:
            continue
        # Version 2 may be encountered after an interrupted/manual upgrade.
        if version == 2 and _has_column(db, "catches", "demo"):
            statements = [statement for statement in sql.split(";") if "ALTER TABLE catches" not in statement]
            db.executescript(";".join(statements))
        else:
            db.executescript(sql)
        db.execute(
            "INSERT INTO schema_migrations VALUES (?, ?)",
            (version, datetime.now(timezone.utc).isoformat()),
        )
        if version == 2:
            _backfill_research_tables(db)
        if version == 4:
            for catch_id, details in db.execute("SELECT id, details FROM catches"):
                db.execute("UPDATE catches SET demo = ? WHERE id = ?",
                           (int(bool(json.loads(details).get("demo"))), catch_id))


def apply_postgres_schema(db) -> None:
    """Create the current schema for a new PostgreSQL deployment."""
    db.executescript("""
        CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS users (
            id BIGSERIAL PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
            salt BYTEA NOT NULL, password_hash BYTEA NOT NULL,
            avatar BYTEA, avatar_updated_at TEXT
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token_hash BYTEA PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at BIGINT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
        ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar BYTEA;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_updated_at TEXT;
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
            token_hash BYTEA PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at BIGINT NOT NULL, used_at BIGINT
        );
        CREATE INDEX IF NOT EXISTS password_reset_expiry ON password_reset_tokens(expires_at);
        CREATE TABLE IF NOT EXISTS auth_attempts (
            client TEXT NOT NULL, window BIGINT NOT NULL, attempts INTEGER NOT NULL,
            PRIMARY KEY (window, client)
        );
        CREATE TABLE IF NOT EXISTS catches (
            id TEXT PRIMARY KEY, created_at TEXT NOT NULL, details TEXT NOT NULL,
            photo BYTEA NOT NULL, owner_id BIGINT REFERENCES users(id), demo INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS catches_owner_date ON catches(owner_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS catches_owner_demo ON catches(owner_id, demo);
        CREATE TABLE IF NOT EXISTS species (
            id BIGSERIAL PRIMARY KEY, scientific_name TEXT NOT NULL UNIQUE,
            common_name TEXT NOT NULL DEFAULT '', region TEXT NOT NULL DEFAULT '',
            identification_supported INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS model_versions (
            id TEXT PRIMARY KEY, feature_version INTEGER NOT NULL, labels_json TEXT NOT NULL,
            metrics_json TEXT, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS fish (
            id TEXT PRIMARY KEY, catch_id TEXT NOT NULL REFERENCES catches(id) ON DELETE CASCADE,
            ordinal INTEGER NOT NULL, reviewed_species TEXT NOT NULL,
            review_status TEXT NOT NULL DEFAULT 'unreviewed', UNIQUE(catch_id, ordinal)
        );
        CREATE INDEX IF NOT EXISTS fish_catch ON fish(catch_id, ordinal);
        CREATE TABLE IF NOT EXISTS predictions (
            id BIGSERIAL PRIMARY KEY, fish_id TEXT NOT NULL REFERENCES fish(id) ON DELETE CASCADE,
            model_id TEXT, predicted_species TEXT NOT NULL, candidates_json TEXT NOT NULL,
            evidence_score DOUBLE PRECISION, needs_review INTEGER NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS measurements (
            id BIGSERIAL PRIMARY KEY, fish_id TEXT NOT NULL REFERENCES fish(id) ON DELETE CASCADE,
            method TEXT NOT NULL, estimated_cm DOUBLE PRECISION, physical_cm DOUBLE PRECISION,
            error_cm DOUBLE PRECISION, calibration_json TEXT, perspective_ok INTEGER NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS reviews (
            id BIGSERIAL PRIMARY KEY, fish_id TEXT NOT NULL REFERENCES fish(id) ON DELETE CASCADE,
            reviewer_id BIGINT NOT NULL REFERENCES users(id), species TEXT NOT NULL,
            reviewed_length_cm DOUBLE PRECISION, endpoints_json TEXT, created_at TEXT NOT NULL
        );
    """)
    db.execute("UPDATE catches SET demo = CASE WHEN COALESCE((details::jsonb ->> 'demo')::boolean, FALSE) THEN 1 ELSE 0 END")
    for version, _ in MIGRATIONS:
        db.execute("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?) ON CONFLICT (version) DO NOTHING",
                   (version, datetime.now(timezone.utc).isoformat()))
