import csv
import io
import json
import math
from contextlib import asynccontextmanager, closing
from datetime import date, datetime, timezone
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field, ValidationError, field_validator
from starlette.concurrency import run_in_threadpool

from .auth import SignedInUser, WriteAccess, router as auth_router
from .chat import RECORD_INTENTS, answer as conversational_answer, context_intent, detect_intent, metadata as conversational_metadata
from .database import DATA, ROOT, connect, init_db
from .imaging import MAX_UPLOAD, jpeg_bytes, open_photo, quality_report
from .species import describe, load_model, predict_candidates

DIST = ROOT / "frontend" / "dist"
MODEL = DATA / "species_model.json"

Point = tuple[Annotated[float, Field(ge=0, le=1)], Annotated[float, Field(ge=0, le=1)]]
Segment = tuple[Point, Point]
PositiveLength = Annotated[float, Field(gt=0, le=1000)]
Habitat = Literal["Freshwater", "Brackish", "Marine"]
PhotoContext = Literal["Landing site", "Fish market", "Onboard", "Survey", "Shore", "Aquaculture", "Other"]


class Calibration(BaseModel):
    ruler: Segment
    fish: Segment
    ruler_cm: PositiveLength
    coplanar: Literal[True]


class Specimen(BaseModel):
    species: str = Field(max_length=120)
    calibration: Calibration | None = None
    measured_cm: PositiveLength | None = None
    weight_g: float | None = Field(default=None, ge=0.01, le=30_000_000)
    crop: Segment | None = None

    @field_validator("species")
    @classmethod
    def clean_species(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Enter a species label or Unknown.")
        return value.strip()


class Catch(BaseModel):
    collected_on: date
    site: str = Field(min_length=1, max_length=120)
    context: PhotoContext
    habitat: Habitat | None = None
    water_body: str = Field(default="", max_length=120)
    gear: str = Field(default="", max_length=120)
    group: str = Field(default="", max_length=120)
    notes: str = Field(default="", max_length=1000)
    demo: bool = False
    specimens: list[Specimen] = Field(min_length=1, max_length=30)

    @field_validator("site")
    @classmethod
    def clean_site(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Enter a site name or code.")
        return value.strip()

    @field_validator("collected_on")
    @classmethod
    def collection_date_not_future(cls, value: date) -> date:
        if value > date.today():
            raise ValueError("Collection date cannot be in the future.")
        return value

    @field_validator("water_body", "gear")
    @classmethod
    def clean_optional_text(cls, value: str) -> str:
        return value.strip()


class CatchMetadata(BaseModel):
    collected_on: date
    site: str = Field(min_length=1, max_length=120)
    context: PhotoContext
    habitat: Habitat | None = None
    water_body: str = Field(default="", max_length=120)
    gear: str = Field(default="", max_length=120)
    group: str = Field(default="", max_length=120)
    notes: str = Field(default="", max_length=1000)
    demo: bool = False

    @field_validator("site")
    @classmethod
    def clean_site(cls, value: str) -> str:
        site = value.strip()
        if not site:
            raise ValueError("Enter a site name or code.")
        return site

    @field_validator("collected_on")
    @classmethod
    def collection_date_not_future(cls, value: date) -> date:
        if value > date.today():
            raise ValueError("Collection date cannot be in the future.")
        return value

    @field_validator("water_body", "gear", "group", "notes")
    @classmethod
    def clean_text(cls, value: str) -> str:
        return value.strip()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await run_in_threadpool(init_db)
    yield


app = FastAPI(title="Reef Catch Monitor", lifespan=lifespan)
app.include_router(auth_router)


@app.middleware("http")
async def prevent_api_caching(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    if request.url.path == "/" or request.url.path.startswith(("/assets/", "/practice.jpg")):
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; "
            "base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
        )
    if request.url.scheme == "https":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, error: RequestValidationError):
    fields = [{"loc": item["loc"], "msg": item["msg"]} for item in error.errors()]
    return JSONResponse({"detail": fields}, status_code=422)


async def read_photo(file: UploadFile) -> Image.Image:
    raw = await file.read(MAX_UPLOAD + 1)
    if len(raw) > MAX_UPLOAD:
        raise HTTPException(413, "Photos must be 12 MB or smaller.")
    try:
        return await run_in_threadpool(open_photo, raw)
    except (OSError, ValueError, UnidentifiedImageError, Image.DecompressionBombError) as error:
        message = str(error) if isinstance(error, ValueError) else "The image could not be opened."
        raise HTTPException(422, message) from error


def parse_json(schema, raw: str):
    try:
        return schema.model_validate_json(raw)
    except ValidationError as error:
        errors = [
            {"loc": item["loc"], "msg": item["msg"]}
            for item in error.errors(include_input=False, include_context=False)
        ]
        raise HTTPException(422, errors) from error


def segment_pixels(segment: Segment, size: tuple[int, int]) -> float:
    start, end = segment
    width, height = size
    return math.hypot((end[0] - start[0]) * width, (end[1] - start[1]) * height)


def estimate_length(calibration: Calibration, size: tuple[int, int]) -> float:
    ruler_pixels = segment_pixels(calibration.ruler, size)
    fish_pixels = segment_pixels(calibration.fish, size)
    if min(ruler_pixels, fish_pixels) < 10:
        raise HTTPException(422, "Place each pair of measurement marks at least 10 image pixels apart.")
    return round(fish_pixels / ruler_pixels * calibration.ruler_cm, 2)


def model_for_request() -> dict | None:
    try:
        return load_model(MODEL)
    except (OSError, ValueError) as error:
        raise HTTPException(503, "The species model could not be loaded. Check the model file.") from error


def suggestion(image: Image.Image, crop: Segment, model: dict) -> dict:
    width, height = image.size
    x1, x2 = sorted(round(point[0] * width) for point in crop)
    y1, y2 = sorted(round(point[1] * height) for point in crop)
    if x2 - x1 < 16 or y2 - y1 < 16:
        raise HTTPException(422, "Mark a fish crop at least 16 pixels wide and high.")
    result = predict_candidates(describe(image.crop((x1, y1, x2, y2))), model)
    return {**result, "model_id": model["model_id"], "method": "regional_descriptor_v2"}


@app.get("/api/status")
def status(user: SignedInUser):
    model = model_for_request()
    with closing(connect()) as db:
        observed = [row[0] for row in db.execute("""
            SELECT fish.reviewed_species FROM fish
            JOIN catches ON catches.id = fish.catch_id
            WHERE catches.owner_id = ? AND lower(fish.reviewed_species) NOT LIKE '%unknown%'
            GROUP BY lower(fish.reviewed_species)
            ORDER BY count(*) DESC, fish.reviewed_species
        """, (user.id,)).fetchall()]
    return {"model_id": model["model_id"] if model else None, "labels": model["labels"] if model else [],
            "observed_labels": observed,
            "feature_version": model.get("feature_version") if model else None,
            "metrics": model.get("metrics") if model else None,
            "supported_conditions": model.get("supported_conditions") if model else None}


@app.get("/api/health", include_in_schema=False)
def health():
    with closing(connect()) as db:
        db.execute("SELECT 1").fetchone()
    return {"status": "ok"}


@app.get("/api/training/manifest.csv")
def training_manifest(user: SignedInUser):
    template = ("image,species,group,split\n"
                "images/fish-a1.jpg,Species A,trip-01,train\n"
                "images/fish-a2.jpg,Species A,trip-02,train\n"
                "images/fish-b1.jpg,Species B,trip-01,train\n"
                "images/fish-b2.jpg,Species B,trip-02,train\n"
                "images/fish-a3.jpg,Species A,trip-03,test\n"
                "images/fish-b3.jpg,Species B,trip-03,test\n")
    return Response(template, media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="training-manifest.csv"'})


@app.post("/api/photos/prepare", dependencies=WriteAccess)
async def prepare_photo(user: SignedInUser, file: Annotated[UploadFile, File()]):
    image = await read_photo(file)
    return Response(await run_in_threadpool(jpeg_bytes, image), media_type="image/jpeg")


@app.post("/api/photos/quality", dependencies=WriteAccess)
async def photo_quality(user: SignedInUser, file: Annotated[UploadFile, File()]):
    image = await read_photo(file)
    return await run_in_threadpool(quality_report, image)


class CropRequest(BaseModel):
    crop: Segment


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=500)
    history: list[dict | str] = Field(default_factory=list, max_length=10)


class ReviewRequest(BaseModel):
    species: str = Field(min_length=1, max_length=120)
    reviewed_length_cm: PositiveLength | None = None
    fish_endpoints: Segment | None = None

    @field_validator("species")
    @classmethod
    def clean_review_species(cls, value: str) -> str:
        species = value.strip()
        if not species:
            raise ValueError("Enter a species label or Unknown / Needs review.")
        return species


class AnnotationUpdate(BaseModel):
    calibration: Calibration | None = None
    crop: Segment | None = None


@app.post("/api/species/suggest", dependencies=WriteAccess)
async def suggest(user: SignedInUser, file: Annotated[UploadFile, File()], metadata: Annotated[str, Form()]):
    request = parse_json(CropRequest, metadata)
    model = await run_in_threadpool(model_for_request)
    if model is None:
        raise HTTPException(409, "Train a model to enable species suggestions.")
    image = await read_photo(file)
    return await run_in_threadpool(suggestion, image, request.crop, model)


def user_catches(owner_id: int) -> list[dict]:
    with closing(connect()) as db:
        rows = db.execute("SELECT details FROM catches WHERE owner_id = ? ORDER BY created_at DESC",
                          (owner_id,)).fetchall()
    return [json.loads(row[0]) for row in rows]


@app.post("/api/chat", dependencies=WriteAccess)
def chat(payload: ChatRequest, user: SignedInUser):
    message = payload.message.strip()
    catches = user_catches(user.id)
    previous_intent = context_intent(payload.history)
    intent = detect_intent(message, previous_intent)
    activity, follow_ups = conversational_metadata(intent)
    fish_count = sum(len(item.get("specimens", [])) for item in catches)
    return {
        "answer": conversational_answer(message, catches, intent, previous_intent),
        "activity": activity,
        "intent": intent,
        "follow_ups": follow_ups,
        "evidence": {"catch_records": len(catches), "specimens": fish_count} if intent in RECORD_INTENTS else None,
    }


def save_catch(image: Image.Image, catch: Catch, owner_id: int) -> dict:
    model = model_for_request() if any(fish.crop for fish in catch.specimens) else None
    details = catch.model_dump(mode="json")
    details["image_width"], details["image_height"] = image.size
    details["analysis_pipeline"] = "reef-analysis-v2"
    for fish, record in zip(catch.specimens, details["specimens"], strict=True):
        estimate = estimate_length(fish.calibration, image.size) if fish.calibration else None
        record["estimated_cm"] = estimate
        record["error_cm"] = round(estimate - fish.measured_cm, 2) if estimate is not None and fish.measured_cm is not None else None
        record["model_suggestion"] = suggestion(image, fish.crop, model) if fish.crop and model else None
        record["measurement_method"] = "ruler_ratio_v1" if fish.calibration else ("physical_measurement" if fish.measured_cm else None)

    catch_id = str(uuid4())
    created_at = datetime.now(timezone.utc).isoformat()
    with closing(connect()) as db, db:
        db.execute("INSERT INTO catches (id, created_at, details, photo, owner_id, demo) VALUES (?, ?, ?, ?, ?, ?)",
                   (catch_id, created_at, json.dumps(details), jpeg_bytes(image), owner_id, int(catch.demo)))
        if model:
            db.execute("""INSERT INTO model_versions (id, feature_version, labels_json, metrics_json, created_at)
                VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING""",
                (model["model_id"], model["feature_version"], json.dumps(model["labels"]),
                 json.dumps(model.get("metrics")) if model.get("metrics") else None, created_at))
        for ordinal, record in enumerate(details["specimens"], 1):
            fish_id = f"{catch_id}:{ordinal}"
            reviewed = record["species"]
            review_status = "reviewed" if reviewed not in {"Unknown", "Unknown / Needs review"} else "unreviewed"
            db.execute("INSERT INTO fish VALUES (?, ?, ?, ?, ?)",
                       (fish_id, catch_id, ordinal, reviewed, review_status))
            predicted = record.get("model_suggestion")
            if predicted:
                db.execute("""INSERT INTO predictions
                    (fish_id, model_id, predicted_species, candidates_json, evidence_score, needs_review, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (fish_id, predicted.get("model_id"), predicted["species"], json.dumps(predicted.get("candidates", [])),
                     predicted.get("evidence_score"), int(predicted.get("needs_review", True)), created_at))
            calibration = record.get("calibration")
            if calibration or record.get("measured_cm") is not None:
                db.execute("""INSERT INTO measurements
                    (fish_id, method, estimated_cm, physical_cm, error_cm, calibration_json, perspective_ok, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (fish_id, "ruler_ratio_v1" if calibration else "physical_measurement", record.get("estimated_cm"),
                     record.get("measured_cm"), record.get("error_cm"), json.dumps(calibration) if calibration else None,
                     int(bool(calibration and calibration.get("coplanar"))), created_at))
    return {"id": catch_id, "created_at": created_at, **details}


@app.post("/api/catches", status_code=201, dependencies=WriteAccess)
async def create_catch(user: SignedInUser, file: Annotated[UploadFile, File()], metadata: Annotated[str, Form()]):
    catch = parse_json(Catch, metadata)
    image = await read_photo(file)
    return await run_in_threadpool(save_catch, image, catch, user.id)


def filtered_catches(owner_id: int, q: str = "", habitat: Habitat | None = None,
                     context: PhotoContext | None = None) -> list[dict]:
    query = q.strip().casefold()
    with closing(connect()) as db:
        rows = db.execute("SELECT id, created_at, details FROM catches WHERE owner_id = ? ORDER BY created_at DESC",
                          (owner_id,)).fetchall()
    catches = []
    for catch_id, created, details in rows:
        record = json.loads(details)
        if (habitat and record.get("habitat") != habitat) or (context and record["context"] != context):
            continue
        if query:
            searchable = [record["site"], record.get("water_body", ""), record.get("gear", ""),
                          record.get("group", ""), *(fish.get("species", "") for fish in record.get("specimens", []))]
            if not any(query in value.casefold() for value in searchable):
                continue
        catches.append({"id": catch_id, "created_at": created, **record})
    return catches


@app.get("/api/catches")
def list_catches(
    user: SignedInUser,
    response: Response,
    q: Annotated[str, Query(max_length=120)] = "",
    habitat: Habitat | None = None,
    context: PhotoContext | None = None,
    sort: Literal["newest", "oldest", "site"] = "newest",
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    catches = filtered_catches(user.id, q=q, habitat=habitat, context=context)
    if sort == "site":
        catches.sort(key=lambda item: ((item.get("site") or "").casefold(), item.get("collected_on") or ""))
    else:
        catches.sort(key=lambda item: item.get("collected_on") or "", reverse=sort == "newest")
    response.headers["X-Total-Count"] = str(len(catches))
    return catches[offset:offset + limit]


@app.get("/api/catches/{catch_id}")
def get_catch(catch_id: UUID, user: SignedInUser):
    with closing(connect()) as db:
        row = db.execute("SELECT created_at, details FROM catches WHERE id = ? AND owner_id = ?",
                         (str(catch_id), user.id)).fetchone()
    if row is None:
        raise HTTPException(404, "Catch record not found.")
    return {"id": str(catch_id), "created_at": row[0], **json.loads(row[1])}


@app.patch("/api/catches/{catch_id}", dependencies=WriteAccess)
def update_catch(catch_id: UUID, payload: CatchMetadata, user: SignedInUser):
    with closing(connect()) as db, db:
        row = db.execute("SELECT created_at, details FROM catches WHERE id = ? AND owner_id = ?",
                         (str(catch_id), user.id)).fetchone()
        if row is None:
            raise HTTPException(404, "Catch record not found.")
        details = json.loads(row[1])
        details.update(payload.model_dump(mode="json"))
        db.execute("UPDATE catches SET details = ?, demo = ? WHERE id = ? AND owner_id = ?",
                   (json.dumps(details), int(payload.demo), str(catch_id), user.id))
    return {"id": str(catch_id), "created_at": row[0], **details}


@app.delete("/api/catches/{catch_id}", status_code=204, dependencies=WriteAccess)
def delete_catch(catch_id: UUID, user: SignedInUser):
    with closing(connect()) as db, db:
        result = db.execute("DELETE FROM catches WHERE id = ? AND owner_id = ?", (str(catch_id), user.id))
        if result.rowcount == 0:
            raise HTTPException(404, "Catch record not found.")
    return Response(status_code=204)


@app.patch("/api/catches/{catch_id}/fish/{ordinal}/review", dependencies=WriteAccess)
def review_fish(catch_id: UUID, ordinal: int, payload: ReviewRequest, user: SignedInUser):
    if ordinal < 1:
        raise HTTPException(404, "Fish not found.")
    with closing(connect()) as db, db:
        row = db.execute("SELECT details FROM catches WHERE id = ? AND owner_id = ?",
                         (str(catch_id), user.id)).fetchone()
        if row is None:
            raise HTTPException(404, "Catch record not found.")
        details = json.loads(row[0])
        if ordinal > len(details.get("specimens", [])):
            raise HTTPException(404, "Fish not found.")
        specimen = details["specimens"][ordinal - 1]
        specimen["species"] = payload.species
        specimen["review"] = {
            "reviewed_by": user.id,
            "reviewed_at": datetime.now(timezone.utc).isoformat(),
            "reviewed_length_cm": payload.reviewed_length_cm,
            "fish_endpoints": payload.fish_endpoints,
        }
        if payload.reviewed_length_cm is not None:
            specimen["measured_cm"] = payload.reviewed_length_cm
            if specimen.get("estimated_cm") is not None:
                specimen["error_cm"] = round(specimen["estimated_cm"] - payload.reviewed_length_cm, 2)
        db.execute("UPDATE catches SET details = ? WHERE id = ?", (json.dumps(details), str(catch_id)))
        fish_id = f"{catch_id}:{ordinal}"
        db.execute("UPDATE fish SET reviewed_species = ?, review_status = 'reviewed' WHERE id = ?",
                   (payload.species, fish_id))
        db.execute("""INSERT INTO reviews
            (fish_id, reviewer_id, species, reviewed_length_cm, endpoints_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?)""",
            (fish_id, user.id, payload.species, payload.reviewed_length_cm,
             json.dumps(payload.fish_endpoints) if payload.fish_endpoints else None,
             specimen["review"]["reviewed_at"]))
    return {"id": str(catch_id), **details}


@app.patch("/api/catches/{catch_id}/fish/{ordinal}/annotation", dependencies=WriteAccess)
def update_annotation(catch_id: UUID, ordinal: int, payload: AnnotationUpdate, user: SignedInUser):
    if ordinal < 1:
        raise HTTPException(404, "Fish not found.")
    with closing(connect()) as db:
        row = db.execute("SELECT created_at, details, photo FROM catches WHERE id = ? AND owner_id = ?",
                         (str(catch_id), user.id)).fetchone()
    if row is None:
        raise HTTPException(404, "Catch record not found.")
    details = json.loads(row[1])
    if ordinal > len(details.get("specimens", [])):
        raise HTTPException(404, "Fish not found.")
    image = open_photo(bytes(row[2]))
    specimen = details["specimens"][ordinal - 1]
    calibration = payload.calibration.model_dump(mode="json") if payload.calibration else None
    estimate = estimate_length(payload.calibration, image.size) if payload.calibration else None
    crop = [list(point) for point in payload.crop] if payload.crop else None
    model = model_for_request() if crop else None
    predicted = suggestion(image, payload.crop, model) if crop and model else None
    specimen["calibration"] = calibration
    specimen["crop"] = crop
    specimen["estimated_cm"] = estimate
    specimen["error_cm"] = round(estimate - specimen["measured_cm"], 2) if estimate is not None and specimen.get("measured_cm") is not None else None
    specimen["measurement_method"] = "ruler_ratio_v1" if calibration else ("physical_measurement" if specimen.get("measured_cm") else None)
    specimen["model_suggestion"] = predicted
    updated_at = datetime.now(timezone.utc).isoformat()
    fish_id = f"{catch_id}:{ordinal}"
    with closing(connect()) as db, db:
        db.execute("UPDATE catches SET details = ? WHERE id = ? AND owner_id = ?",
                   (json.dumps(details), str(catch_id), user.id))
        db.execute("DELETE FROM measurements WHERE fish_id = ?", (fish_id,))
        if calibration or specimen.get("measured_cm") is not None:
            db.execute("""INSERT INTO measurements
                (fish_id, method, estimated_cm, physical_cm, error_cm, calibration_json, perspective_ok, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (fish_id, specimen["measurement_method"], estimate, specimen.get("measured_cm"), specimen.get("error_cm"),
                 json.dumps(calibration) if calibration else None, int(bool(calibration)), updated_at))
        db.execute("DELETE FROM predictions WHERE fish_id = ?", (fish_id,))
        if predicted:
            db.execute("""INSERT INTO predictions
                (fish_id, model_id, predicted_species, candidates_json, evidence_score, needs_review, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (fish_id, predicted.get("model_id"), predicted["species"], json.dumps(predicted.get("candidates", [])),
                 predicted.get("evidence_score"), int(predicted.get("needs_review", True)), updated_at))
    return {"id": str(catch_id), "created_at": row[0], **details}


@app.get("/api/catches/{catch_id}/photo")
def catch_photo(catch_id: UUID, user: SignedInUser):
    with closing(connect()) as db:
        row = db.execute("SELECT photo FROM catches WHERE id = ? AND owner_id = ?", (str(catch_id), user.id)).fetchone()
    if row is None:
        raise HTTPException(404, "Catch photo not found.")
    return Response(row[0], media_type="image/jpeg")


@app.put("/api/catches/{catch_id}/photo", dependencies=WriteAccess)
async def replace_catch_photo(catch_id: UUID, user: SignedInUser, file: Annotated[UploadFile, File()]):
    image = await read_photo(file)
    with closing(connect()) as db:
        row = db.execute("SELECT created_at, details FROM catches WHERE id = ? AND owner_id = ?",
                         (str(catch_id), user.id)).fetchone()
    if row is None:
        raise HTTPException(404, "Catch record not found.")
    details = json.loads(row[1])
    details["image_width"], details["image_height"] = image.size
    details["photo_updated_at"] = datetime.now(timezone.utc).isoformat()
    for specimen in details.get("specimens", []):
        specimen["calibration"] = None
        specimen["crop"] = None
        specimen["estimated_cm"] = None
        specimen["error_cm"] = None
        specimen["model_suggestion"] = None
        specimen["measurement_method"] = "physical_measurement" if specimen.get("measured_cm") is not None else None
    with closing(connect()) as db, db:
        db.execute("UPDATE catches SET details = ?, photo = ? WHERE id = ? AND owner_id = ?",
                   (json.dumps(details), jpeg_bytes(image), str(catch_id), user.id))
        for ordinal, specimen in enumerate(details.get("specimens", []), 1):
            fish_id = f"{catch_id}:{ordinal}"
            db.execute("DELETE FROM predictions WHERE fish_id = ?", (fish_id,))
            db.execute("DELETE FROM measurements WHERE fish_id = ?", (fish_id,))
            if specimen.get("measured_cm") is not None:
                db.execute("""INSERT INTO measurements
                    (fish_id, method, estimated_cm, physical_cm, error_cm, calibration_json, perspective_ok, created_at)
                    VALUES (?, 'physical_measurement', NULL, ?, NULL, NULL, 0, ?)""",
                    (fish_id, specimen["measured_cm"], details["photo_updated_at"]))
    return {"id": str(catch_id), "created_at": row[0], **details}


def csv_value(value):
    if isinstance(value, str) and (value.lstrip().startswith(("=", "+", "-", "@")) or value.startswith(("\t", "\r", "\n"))):
        return "'" + value
    return value


@app.get("/api/export.csv")
def export_catches(
    user: SignedInUser,
    q: Annotated[str, Query(max_length=120)] = "",
    habitat: Habitat | None = None,
    context: PhotoContext | None = None,
):
    output = io.StringIO()
    writer = csv.writer(output)
    columns = ["id", "created_at", "collected_on", "site", "context", "group", "demo", "specimen", "species",
               "review_status", "reviewed_by", "reviewed_at", "estimated_cm",
               "measured_cm", "error_cm", "model_species", "model_distance", "model_id", "image_width",
               "image_height", "ruler_cm", "ruler_points", "fish_points", "crop", "notes",
               "habitat", "water_body", "gear", "weight_g"]
    writer.writerow(columns)
    for catch in filtered_catches(user.id, q=q, habitat=habitat, context=context):
        for index, fish in enumerate(catch["specimens"], 1):
            model = fish.get("model_suggestion") or {}
            calibration = fish.get("calibration") or {}
            review = fish.get("review") or {}
            species = fish.get("species") or "Unknown / Needs review"
            row = {**catch, **fish, "specimen": index, "model_species": model.get("species"),
                   "model_distance": model.get("distance"), "model_id": model.get("model_id"),
                   "ruler_cm": calibration.get("ruler_cm"), "ruler_points": calibration.get("ruler"),
                   "fish_points": calibration.get("fish"),
                   "review_status": "unreviewed" if "unknown" in species.casefold() else "reviewed",
                   "reviewed_by": review.get("reviewed_by"), "reviewed_at": review.get("reviewed_at")}
            writer.writerow(csv_value(json.dumps(row.get(key)) if isinstance(row.get(key), list) else row.get(key)) for key in columns)
    return Response(output.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="reef-catches.csv"'})


if DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/", include_in_schema=False)
    def index():
        return FileResponse(DIST / "index.html")

    @app.get("/practice.jpg", include_in_schema=False)
    def practice():
        return FileResponse(DIST / "practice.jpg")

    @app.get("/favicon.svg", include_in_schema=False)
    def favicon():
        return FileResponse(DIST / "favicon.svg", media_type="image/svg+xml")
