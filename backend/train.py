"""Train and evaluate the crop classifier using a collection-group split."""

import argparse
import csv
import json
import os
import tempfile
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

from .imaging import open_photo
from .species import FEATURE_VERSION, describe, predict, predict_candidates


def classification_metrics(actual: list[str], predicted: list[str], labels: list[str]) -> dict:
    confusion = {label: {candidate: 0 for candidate in [*labels, "Unknown / Needs review"]} for label in labels}
    for truth, guess in zip(actual, predicted, strict=True):
        confusion[truth][guess] += 1
    per_species = {}
    for label in labels:
        tp = confusion[label][label]
        fp = sum(confusion[other][label] for other in labels if other != label)
        fn = sum(count for guess, count in confusion[label].items() if guess != label)
        precision = tp / (tp + fp) if tp + fp else 0.0
        recall = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        per_species[label] = {"precision": round(precision, 4), "recall": round(recall, 4), "f1": round(f1, 4), "support": sum(confusion[label].values())}
    return {
        "accuracy": round(sum(truth == guess for truth, guess in zip(actual, predicted, strict=True)) / len(actual), 4),
        "macro_f1": round(sum(item["f1"] for item in per_species.values()) / len(labels), 4),
        "macro_precision": round(sum(item["precision"] for item in per_species.values()) / len(labels), 4),
        "macro_recall": round(sum(item["recall"] for item in per_species.values()) / len(labels), 4),
        "per_species": per_species,
        "confusion_actual_by_predicted": confusion,
    }


def train(manifest: Path) -> tuple[dict, dict]:
    with manifest.open(encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        if not {"image", "species", "group", "split"} <= set(reader.fieldnames or []):
            raise ValueError("Manifest columns must include image,species,group,split.")
        rows = list(reader)
    groups, images, training, validation, evaluation = {}, set(), defaultdict(list), [], []
    for line, row in enumerate(rows, 2):
        image, species, group, split = ((row[field] or "").strip() for field in ("image", "species", "group", "split"))
        if not all((image, species, group)) or split not in ("train", "validation", "test"):
            raise ValueError(f"Row {line} requires an image, species, group, and a train, validation, or test split.")
        path = (manifest.parent / image).resolve()
        if path in images:
            raise ValueError(f"Row {line} repeats an image path.")
        images.add(path)
        if groups.setdefault(group, split) != split:
            raise ValueError(f"Group {group!r} appears in both splits.")
        features = describe(open_photo(path.read_bytes()))
        if split == "train":
            training[species].append(features)
        elif split == "validation":
            validation.append((species, features))
        else:
            evaluation.append((species, features))

    test_counts = Counter(label for label, _ in evaluation)
    if len(training) < 2 or any(len(samples) < 2 for samples in training.values()):
        raise ValueError("Provide at least two training images per species and at least two species.")
    if test_counts.keys() != training.keys():
        raise ValueError("Use the same species in both splits, with at least one test image per species.")

    labels = sorted(training)
    centroids = [np.mean(training[label], axis=0) for label in labels]
    fitted_distances = {
        label: [float(np.linalg.norm(sample - centroids[index])) for sample in training[label]]
        for index, label in enumerate(labels)
    }
    thresholds = {
        label: max(0.08, float(np.quantile(distances, 0.95)) * 1.35)
        for label, distances in fitted_distances.items()
    }
    # Validation samples expand (never shrink) thresholds; test data is untouched.
    for label, features in validation:
        if label not in training:
            raise ValueError(f"Validation species {label!r} is absent from training.")
        index = labels.index(label)
        thresholds[label] = max(thresholds[label], float(np.linalg.norm(features - centroids[index])) * 1.05)
    model = {
        "feature_version": FEATURE_VERSION,
        "labels": labels,
        "centroids": [centroid.tolist() for centroid in centroids],
        "thresholds": thresholds,
        "global_threshold": float(np.median(list(thresholds.values()))),
        "supported_conditions": "Single fish, tight crop, visible side profile; trained regions and capture contexts only.",
    }
    actual = [label for label, _ in evaluation]
    baseline_predictions = [predict(features, model)[0] for _, features in evaluation]
    improved_predictions = [predict_candidates(features, model)["species"] for _, features in evaluation]
    baseline = classification_metrics(actual, baseline_predictions, labels)
    improved = classification_metrics(actual, improved_predictions, labels)
    return model, {
        "training_images": sum(map(len, training.values())),
        "validation_images": len(validation),
        "held_out_images": len(evaluation),
        "held_out_groups": sum(split == "test" for split in groups.values()),
        "baseline_forced_nearest_centroid": baseline,
        "improved_with_abstention": improved,
        "abstention_rate": round(sum(value == "Unknown / Needs review" for value in improved_predictions) / len(evaluation), 4),
        "note": "Metrics are from the supplied held-out groups; no bundled field-accuracy claim is made.",
    }


def evaluate_lengths(manifest: Path) -> dict:
    with manifest.open(encoding="utf-8-sig", newline="") as source:
        rows = list(csv.DictReader(source))
    required = {"estimated_cm", "physical_cm", "group"}
    if not rows or not required <= set(rows[0]):
        raise ValueError("Length manifest columns must include estimated_cm,physical_cm,group.")
    errors = []
    for line, row in enumerate(rows, 2):
        try:
            estimated, physical = float(row["estimated_cm"]), float(row["physical_cm"])
        except (TypeError, ValueError) as error:
            raise ValueError(f"Row {line} has an invalid length.") from error
        if estimated <= 0 or physical <= 0 or not row["group"].strip():
            raise ValueError(f"Row {line} requires positive lengths and a specimen/session group.")
        errors.append(estimated - physical)
    return {
        "samples": len(errors), "groups": len({row["group"].strip() for row in rows}),
        "mean_absolute_error_cm": round(sum(abs(value) for value in errors) / len(errors), 4),
        "mean_signed_error_cm": round(sum(errors) / len(errors), 4),
        "root_mean_squared_error_cm": round(float(np.sqrt(np.mean(np.square(errors)))), 4),
        "note": "Use independent specimens/sessions and a consistent physical endpoint convention.",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path, nargs="?")
    parser.add_argument("--output", type=Path, default=Path("data/species_model.json"))
    parser.add_argument("--length-manifest", type=Path, help="Evaluate estimated_cm against physical_cm instead of training species.")
    args = parser.parse_args()
    try:
        if args.length_manifest:
            print(json.dumps(evaluate_lengths(args.length_manifest), indent=2))
            return
        if args.manifest is None:
            parser.error("manifest is required unless --length-manifest is used")
        model, metrics = train(args.manifest)
        model["metrics"] = metrics
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(mode="w", dir=args.output.parent, delete=False) as file:
            try:
                json.dump(model, file, ensure_ascii=False)
                file.close()
                os.replace(file.name, args.output)
            finally:
                Path(file.name).unlink(missing_ok=True)
    except (OSError, ValueError) as error:
        parser.exit(2, f"{error}\n")
    print(json.dumps(metrics, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
