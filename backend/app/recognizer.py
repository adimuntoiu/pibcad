import io
import json
import logging
import numpy as np
import torch
from PIL import Image
import open_clip

from .config import settings

logger = logging.getLogger("painting_recognizer")


class PaintingRecognizer:
    def __init__(self) -> None:
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model = None
        self.preprocess = None
        self.embeddings = None
        self.embedding_ids = []
        self.paintings = {}

    def load(self) -> None:
        logger.info(f"Loading CLIP model {settings.clip_model_name} ({settings.clip_pretrained}) on {self.device}...")
        self.model, _, self.preprocess = open_clip.create_model_and_transforms(
            settings.clip_model_name,
            pretrained=settings.clip_pretrained,
            device=self.device,
        )
        self.model.eval()
        self._load_catalog_and_index()

    def _load_catalog_and_index(self) -> None:
        paintings_json = settings.data_dir / "paintings.json"
        if paintings_json.exists():
            with open(paintings_json, "r", encoding="utf-8") as f:
                raw_list = json.load(f)
                self.paintings = {p["id"]: p for p in raw_list}

        index_dir = settings.data_dir / "index"
        emb_path = index_dir / "embeddings.npy"
        meta_path = index_dir / "index_meta.json"

        if emb_path.exists() and meta_path.exists():
            self.embeddings = np.load(emb_path)
            with open(meta_path, "r", encoding="utf-8") as f:
                meta = json.load(f)
                self.embedding_ids = meta["embedding_painting_ids"]
                if "paintings" in meta:
                    self.paintings.update(meta["paintings"])
            logger.info(f"Loaded {len(self.embedding_ids)} embeddings for {len(self.paintings)} paintings.")
        else:
            logger.warning(f"Index files not found in {index_dir}. Run python scripts/build_index.py to generate embeddings.")

    def recognize(self, image_bytes: bytes) -> dict:
        if self.embeddings is None or len(self.embedding_ids) == 0:
            logger.warning("Recognition requested but index is empty.")
            return {
                "match": False,
                "id": None,
                "title": None,
                "artist": None,
                "confidence": 0.0,
            }

        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        tensor = self.preprocess(img).unsqueeze(0).to(self.device)

        with torch.no_grad():
            feat = self.model.encode_image(tensor)
            feat = feat / feat.norm(dim=-1, keepdim=True)
            query_vec = feat.cpu().numpy()[0].astype(np.float32)

        raw_sims = np.dot(self.embeddings, query_vec)

        best_per_painting = {}
        for idx, pid in enumerate(self.embedding_ids):
            score = float(raw_sims[idx])
            if pid not in best_per_painting or score > best_per_painting[pid]:
                best_per_painting[pid] = score

        ranked = sorted(best_per_painting.items(), key=lambda x: x[1], reverse=True)
        best_id, best_score = ranked[0]
        second_id, second_score = ranked[1] if len(ranked) > 1 else ("none", 0.0)
        margin = best_score - second_score

        is_match = (
            best_score >= settings.similarity_threshold
            and margin >= settings.similarity_margin
        )

        logger.info(
            f"Recognize | top='{best_id}' ({best_score:.4f}) | "
            f"second='{second_id}' ({second_score:.4f}) | "
            f"margin={margin:.4f} (req>={settings.similarity_margin}) | "
            f"thresh={settings.similarity_threshold} -> match={is_match}"
        )

        if is_match:
            painting = self.paintings.get(best_id, {})
            return {
                "match": True,
                "id": best_id,
                "title": painting.get("title", "Unknown Title"),
                "artist": painting.get("artist", "Unknown Artist"),
                "confidence": round(best_score, 4),
            }

        return {
            "match": False,
            "id": None,
            "title": None,
            "artist": None,
            "confidence": round(best_score, 4),
        }


recognizer = PaintingRecognizer()
