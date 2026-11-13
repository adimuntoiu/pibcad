#!/usr/bin/env python3
"""
Builds the orientation-aware embedding index (embeddings.npy + index_meta.json)
for all paintings across their 4 orientations (0°, 90°, 180°, 270°).

Features:
- Auto-generates 0°, 90°, 180°, 270° clockwise rotations from each painting's main image.
- Allows overriding or supplementing any orientation (0/90/180/270) with real reference photos
  via `orientation_photos` in paintings.json or CLI flags.
- Uses the configured EmbeddingEncoder (CLIP via open_clip, DINOv2, or spatial fallback).
"""

import argparse
import json
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

BASE_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BASE_DIR.parent
sys.path.insert(0, str(BASE_DIR))

from app.config import settings  # noqa: E402
from app.embeddings import EmbeddingEncoder  # noqa: E402

DATA_DIR = settings.data_dir
PAINTINGS_JSON = DATA_DIR / "paintings.json"
IMAGES_DIR = DATA_DIR / "paintings"
ORIENTATIONS_DIR = IMAGES_DIR / "orientations"
INDEX_DIR = DATA_DIR / "index"

ROTATIONS = (0, 90, 180, 270)


def ensure_demo_painting_images() -> None:
    """
    Ensures the reference PNG images for painting-a-solar and painting-b-lunar exist
    in backend/data/paintings/, rasterizing from static/demo-targets/*.svg or generating via Pillow.
    """
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    targets = [
        ("painting_a_solar.png", PROJECT_ROOT / "static/demo-targets/painting-a.svg", "A"),
        ("painting_b_lunar.png", PROJECT_ROOT / "static/demo-targets/painting-b.svg", "B"),
    ]

    for filename, svg_path, kind in targets:
        out_path = IMAGES_DIR / filename
        if out_path.exists():
            continue

        # Try CairoSVG first if available
        if svg_path.exists():
            try:
                import cairosvg

                cairosvg.svg2png(url=str(svg_path), write_to=str(out_path), output_width=512, output_height=512)
                print(f"Rasterized {svg_path.name} -> {out_path}")
                continue
            except Exception:
                pass

        # Pure Pillow procedural fallback matching the SVG quadrant color signatures
        img = Image.new("RGB", (512, 512), (24, 20, 48))
        draw = ImageDraw.Draw(img)
        for r in range(250, 10, -10):
            if kind == "A":
                color = (
                    min(255, 180 + (250 - r) // 3),
                    min(255, 70 + (250 - r) // 2),
                    max(20, 90 - (250 - r) // 4),
                )
                cx, cy = 280, 256
            else:
                color = (
                    max(15, 70 - (250 - r) // 5),
                    min(255, 110 + (250 - r) // 2),
                    min(255, 190 + (250 - r) // 4),
                )
                cx, cy = 232, 256
            draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color)

        # Asymmetric quadrant markers (TL=Emerald, TR=Amber, BL=Blue, BR=Violet)
        draw.polygon([(50, 40), (95, 95), (30, 95)], fill=(52, 211, 153))
        draw.rectangle([420, 40, 475, 95], fill=(251, 191, 36))
        draw.ellipse([40, 420, 95, 475], fill=(96, 165, 250))
        draw.polygon([(450, 415), (485, 475), (415, 475)], fill=(192, 132, 252))

        img.save(out_path)
        print(f"Generated reference image -> {out_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build orientation-aware painting embeddings index.")
    parser.add_argument(
        "--no-auto-rotate",
        action="store_true",
        help="Disable automatic 0/90/180/270 rotation when orientation_photos are missing.",
    )
    args = parser.parse_args()

    ensure_demo_painting_images()

    if not PAINTINGS_JSON.exists():
        print(f"Error: {PAINTINGS_JSON} not found.")
        sys.exit(1)

    INDEX_DIR.mkdir(parents=True, exist_ok=True)
    ORIENTATIONS_DIR.mkdir(parents=True, exist_ok=True)

    with open(PAINTINGS_JSON, "r", encoding="utf-8") as f:
        paintings = json.load(f)

    encoder = EmbeddingEncoder()
    encoder.load()

    embeddings_list: list[np.ndarray] = []
    entries_meta: list[dict] = []

    for item in paintings:
        painting_id = item["id"]
        main_img_name = item.get("image")
        main_img_path = IMAGES_DIR / main_img_name if main_img_name else None
        orientation_photos: dict[str, list[str]] = item.get("orientation_photos") or {}

        base_img: Image.Image | None = None
        if main_img_path and main_img_path.exists():
            base_img = Image.open(main_img_path).convert("RGB")

        for rot in ROTATIONS:
            override_files = orientation_photos.get(str(rot)) or []
            indexed_for_rot = 0

            # 1. Index real override photos if provided for this orientation
            for fname in override_files:
                photo_path = IMAGES_DIR / fname
                if not photo_path.exists():
                    print(f"Warning: Override photo {photo_path} not found, skipping.")
                    continue
                img = Image.open(photo_path).convert("RGB")
                vec = encoder.encode(img)
                embeddings_list.append(vec)
                entries_meta.append(
                    {
                        "painting_id": painting_id,
                        "orientation": rot,
                        "source": fname,
                        "mode": "photo_override",
                    }
                )
                indexed_for_rot += 1
                print(f"Indexed override photo: ({painting_id}, {rot}°) <- {fname}")

            # 2. Auto-generate rotated orientation from main image if no override photos were indexed
            if indexed_for_rot == 0 and not args.no_auto_rotate and base_img is not None:
                # PIL rotate() is counter-clockwise, so -rot rotates clockwise by `rot` degrees
                rotated_img = base_img.rotate(-rot, expand=True) if rot != 0 else base_img.copy()
                rot_filename = f"{painting_id}_rot{rot}.jpg"
                rot_save_path = ORIENTATIONS_DIR / rot_filename
                rotated_img.save(rot_save_path, quality=92)

                vec = encoder.encode(rotated_img)
                embeddings_list.append(vec)
                entries_meta.append(
                    {
                        "painting_id": painting_id,
                        "orientation": rot,
                        "source": f"orientations/{rot_filename}",
                        "mode": "auto_rotated",
                    }
                )
                print(f"Indexed auto-rotated:   ({painting_id}, {rot}°) -> {rot_filename}")

    if not embeddings_list:
        print("Error: No embeddings were generated.")
        sys.exit(1)

    embeddings_matrix = np.vstack(embeddings_list).astype(np.float32)
    np.save(INDEX_DIR / "embeddings.npy", embeddings_matrix)

    meta = {
        "backbone": encoder.active_backbone,
        "dimension": int(embeddings_matrix.shape[1]),
        "entries": entries_meta,
        "embedding_painting_ids": [e["painting_id"] for e in entries_meta],
        "paintings": {p["id"]: p for p in paintings},
    }
    with open(INDEX_DIR / "index_meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)

    print(
        f"\nSuccessfully built index: {len(entries_meta)} orientation entries across "
        f"{len(paintings)} paintings (backbone={encoder.active_backbone}, dim={embeddings_matrix.shape[1]})."
    )
    print(f"Saved to {INDEX_DIR}")


if __name__ == "__main__":
    main()
