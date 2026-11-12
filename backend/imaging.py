import io

import numpy as np

from PIL import Image, ImageOps

MAX_UPLOAD = 12 * 1024 * 1024
MAX_PIXELS = 32_000_000
MAX_SIDE = 2400
FORMATS = {"JPEG", "PNG", "WEBP"}


def open_photo(raw: bytes) -> Image.Image:
    with Image.open(io.BytesIO(raw)) as image:
        if image.format not in FORMATS:
            raise ValueError("Use a JPEG, PNG, or WebP image.")
        if image.width * image.height > MAX_PIXELS:
            raise ValueError("Use a photo with 32 megapixels or fewer.")
        if getattr(image, "is_animated", False):
            raise ValueError("Use a single still image.")
        oriented = ImageOps.exif_transpose(image).convert("RGB")
    oriented.thumbnail((MAX_SIDE, MAX_SIDE), Image.Resampling.LANCZOS)
    return oriented


def jpeg_bytes(image: Image.Image) -> bytes:
    output = io.BytesIO()
    image.save(output, format="JPEG", quality=92)
    return output.getvalue()


def quality_report(image: Image.Image) -> dict:
    """Return reproducible, advisory capture-quality checks.

    Thresholds are engineering heuristics, not biological validation results.
    They intentionally warn instead of rejecting field photographs.
    """
    gray = np.asarray(ImageOps.fit(image.convert("L"), (512, 512), Image.Resampling.BILINEAR), dtype=np.float32)
    brightness = float(gray.mean())
    contrast = float(gray.std())
    # Variance of a discrete Laplacian is a useful no-model blur indicator.
    laplacian = (-4 * gray + np.roll(gray, 1, 0) + np.roll(gray, -1, 0)
                 + np.roll(gray, 1, 1) + np.roll(gray, -1, 1))
    sharpness = float(laplacian[2:-2, 2:-2].var())
    warnings = []
    # Images around standard-definition size are still usable for manual endpoints.
    # Reserve the advisory for genuinely small inputs instead of rejecting common
    # phone, messaging-app, and field-camera exports such as 725 × 483.
    if min(image.size) < 360:
        warnings.append("Very low resolution may make endpoints and species features hard to review. The photo is still accepted; zoom in and place markers carefully.")
    if brightness < 45:
        warnings.append("The photo is very dark; use diffuse light and avoid deep shadows.")
    elif brightness > 220:
        warnings.append("The photo is very bright; reduce glare and clipped highlights.")
    if contrast < 24:
        warnings.append("Low contrast may hide fins and body markings.")
    if sharpness < 90:
        warnings.append("The photo may be blurred; stabilize the camera and refocus.")
    return {
        "width": image.width,
        "height": image.height,
        "brightness": round(brightness, 1),
        "contrast": round(contrast, 1),
        "sharpness": round(sharpness, 1),
        "warnings": warnings,
        "acceptable": not warnings,
        "method": "capture_quality_v1",
    }
