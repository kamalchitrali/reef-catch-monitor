"""A transparent supervised crop classifier with calibrated abstention."""

import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter, ImageOps

FEATURE_VERSION = 2


def describe(image: Image.Image) -> np.ndarray:
    # Normalize orientation and mild illumination changes while retaining colour.
    source = image.convert("RGB")
    if source.height > source.width:
        source = source.transpose(Image.Transpose.ROTATE_90)
    sample = ImageOps.fit(source, (96, 48), Image.Resampling.LANCZOS)
    luminance = ImageOps.autocontrast(sample.convert("L"), cutoff=1)
    hsv = np.asarray(sample.convert("HSV"))
    edges = np.asarray(luminance.filter(ImageFilter.FIND_EDGES))
    descriptor = []
    for y in (0, 24):
        for x in (0, 32, 64):
            tile = hsv[y:y+24, x:x+32]
            for channel in range(3):
                descriptor.extend(np.bincount(tile[:, :, channel].ravel() // 32, minlength=8) / 768)
            tile_edges = edges[y:y+24, x:x+32]
            descriptor.extend(np.bincount(tile_edges.ravel() // 32, minlength=8) / 768)
    vector = np.asarray(descriptor, dtype=np.float64)
    norm = np.linalg.norm(vector)
    return vector / norm if norm else vector


def load_model(path: Path) -> dict | None:
    try:
        raw = path.read_bytes()
    except FileNotFoundError:
        return None
    model = json.loads(raw)
    if model.get("feature_version") != FEATURE_VERSION:
        raise ValueError("Model feature version differs. Retrain with the current pipeline.")
    labels = model.get("labels")
    centroids = model.get("centroids")
    if not isinstance(labels, list) or len(labels) < 2 or not all(isinstance(label, str) and label.strip() for label in labels):
        raise ValueError("Model labels are missing or invalid. Retrain the species model.")
    if not isinstance(centroids, list) or len(centroids) != len(labels):
        raise ValueError("Model centroids do not match its labels. Retrain the species model.")
    if len(set(label.casefold() for label in labels)) != len(labels):
        raise ValueError("Model labels must be unique. Retrain with consistent species names.")
    try:
        matrix = np.asarray(centroids, dtype=np.float64)
    except (TypeError, ValueError) as error:
        raise ValueError("Model centroids contain invalid values. Retrain the species model.") from error
    if matrix.ndim != 2 or not matrix.shape[1] or not np.isfinite(matrix).all():
        raise ValueError("Model centroids contain invalid values. Retrain the species model.")
    return {**model, "model_id": hashlib.sha256(raw).hexdigest()[:12]}


def predict(feature: np.ndarray, model: dict) -> tuple[str, float]:
    distances = np.linalg.norm(np.asarray(model["centroids"]) - feature, axis=1)
    closest = int(np.argmin(distances))
    return model["labels"][closest], float(distances[closest])


def predict_candidates(feature: np.ndarray, model: dict, limit: int = 3) -> dict:
    """Rank labels and abstain outside the fitted within-class distance."""
    distances = np.linalg.norm(np.asarray(model["centroids"]) - feature, axis=1)
    ranked = np.argsort(distances)[:limit]
    candidates = [
        {"species": model["labels"][int(index)], "distance": round(float(distances[index]), 4)}
        for index in ranked
    ]
    best_index = int(ranked[0])
    threshold = float(model.get("thresholds", {}).get(model["labels"][best_index], model.get("global_threshold", 0.45)))
    evidence = max(0.0, min(1.0, 1.0 - float(distances[best_index]) / max(threshold, 1e-9)))
    needs_review = bool(distances[best_index] > threshold)
    return {
        "species": "Unknown / Needs review" if needs_review else model["labels"][best_index],
        "candidates": candidates,
        "distance": round(float(distances[best_index]), 4),
        "evidence_score": round(evidence, 4),
        "threshold": round(threshold, 4),
        "needs_review": needs_review,
    }
