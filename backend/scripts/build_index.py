import json
import sys
from pathlib import Path
import numpy as np
import torch
from PIL import Image
import open_clip

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
PAINTINGS_JSON = DATA_DIR / "paintings.json"
IMAGES_DIR = DATA_DIR / "paintings"
INDEX_DIR = DATA_DIR / "index"

MODEL_NAME = "ViT-B-32"
PRETRAINED = "laion2b_s34b_b79k"


def main() -> None:
    if not PAINTINGS_JSON.exists():
        print(f"Error: {PAINTINGS_JSON} not found.")
        sys.exit(1)

    INDEX_DIR.mkdir(parents=True, exist_ok=True)

    with open(PAINTINGS_JSON, "r", encoding="utf-8") as f:
        paintings = json.load(f)

    print(f"Loading CLIP model {MODEL_NAME} ({PRETRAINED})...")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model, _, preprocess = open_clip.create_model_and_transforms(
        MODEL_NAME, pretrained=PRETRAINED, device=device
    )
    model.eval()

    embeddings_list = []
    embedding_painting_ids = []

    for item in paintings:
        painting_id = item["id"]
        img_filenames = item.get("images") or ([item["image"]] if "image" in item else [])

        if not img_filenames:
            print(f"Warning: No images listed for painting '{painting_id}', skipping.")
            continue

        for fname in img_filenames:
            img_path = IMAGES_DIR / fname
            if not img_path.exists():
                print(f"Warning: Image file {img_path} does not exist, skipping.")
                continue

            try:
                img = Image.open(img_path).convert("RGB")
                tensor = preprocess(img).unsqueeze(0).to(device)
                with torch.no_grad():
                    feat = model.encode_image(tensor)
                    feat = feat / feat.norm(dim=-1, keepdim=True)
                embeddings_list.append(feat.cpu().numpy()[0])
                embedding_painting_ids.append(painting_id)
                print(f"Indexed: {painting_id} <- {fname}")
            except Exception as exc:
                print(f"Error processing {img_path}: {exc}")

    if not embeddings_list:
        print("Error: No valid images were indexed. Place images in backend/data/paintings/.")
        sys.exit(1)

    embeddings_matrix = np.vstack(embeddings_list).astype(np.float32)
    np.save(INDEX_DIR / "embeddings.npy", embeddings_matrix)

    meta = {
        "model_name": MODEL_NAME,
        "pretrained": PRETRAINED,
        "embedding_painting_ids": embedding_painting_ids,
        "paintings": {p["id"]: p for p in paintings},
    }
    with open(INDEX_DIR / "index_meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)

    print(f"\nSuccessfully built index with {len(embeddings_list)} embeddings across {len(paintings)} paintings.")
    print(f"Saved to {INDEX_DIR}")


if __name__ == "__main__":
    main()
