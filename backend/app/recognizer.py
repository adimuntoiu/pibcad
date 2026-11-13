import io
import json
import logging
from typing import Any
import numpy as np
from PIL import Image

from .config import settings
from .embeddings import EmbeddingEncoder

logger = logging.getLogger("painting_recognizer")


class PaintingRecognizer:
    """
    In-memory NumPy cosine similarity recognizer returning (painting_id, orientation).
    Each painting has 4 reference orientations (0, 90, 180, 270), optionally several photos each.
    Loads from Supabase at startup when configured, falling back to local data/index/.
    """

    def __init__(self) -> None:
        self.encoder = EmbeddingEncoder()
        self.embeddings: np.ndarray | None = None
        self.entries: list[dict[str, Any]] = []
        self.paintings: dict[str, dict[str, Any]] = {}

    def load(self) -> None:
        self.encoder.load()
        self.reload()

    def reload(self) -> dict[str, Any]:
        loaded_from_supabase = False
        if settings.supabase_url and settings.supabase_service_role_key:
            loaded_from_supabase = self._try_load_from_supabase()

        if not loaded_from_supabase:
            self._load_local_index()

        return {
            "backbone": self.encoder.active_backbone,
            "indexed_embeddings": len(self.entries),
            "paintings_count": len(self.paintings),
            "source": "supabase" if loaded_from_supabase else "local",
        }

    def _try_load_from_supabase(self) -> bool:
        try:
            from supabase import create_client

            client = create_client(settings.supabase_url, settings.supabase_service_role_key)
            paintings_res = (
                client.table("paintings")
                .select("*, artists(name), painting_orientations(*)")
                .eq("published", True)
                .execute()
            )
            rows = paintings_res.data or []
            if not rows:
                return False

            # Check if index_meta & embeddings are stored in tracking-targets or local cache
            logger.info(f"Fetched {len(rows)} published paintings from Supabase.")
            for row in rows:
                pid = row["id"]
                artist_info = row.get("artists") or {}
                self.paintings[pid] = {
                    "id": pid,
                    "title": row.get("title", pid),
                    "artist": artist_info.get("name", "Unknown Artist"),
                }
            # Still load embeddings array from local cache if built by build_index.py
            self._load_local_index(preserve_paintings=True)
            return self.embeddings is not None and len(self.entries) > 0
        except Exception as exc:
            logger.warning(f"Supabase index load skipped ({exc}); using local index.")
            return False

    def _load_local_index(self, preserve_paintings: bool = False) -> None:
        if not preserve_paintings:
            self.paintings = {}

        paintings_json = settings.data_dir / "paintings.json"
        if paintings_json.exists():
            with open(paintings_json, "r", encoding="utf-8") as f:
                raw_list = json.load(f)
                for p in raw_list:
                    self.paintings[p["id"]] = p

        index_dir = settings.data_dir / "index"
        emb_path = index_dir / "embeddings.npy"
        meta_path = index_dir / "index_meta.json"

        if emb_path.exists() and meta_path.exists():
            loaded_emb = np.load(emb_path)
            with open(meta_path, "r", encoding="utf-8") as f:
                meta = json.load(f)

            if "paintings" in meta:
                self.paintings.update(meta["paintings"])

            if "entries" in meta:
                self.entries = meta["entries"]
            else:
                # Legacy fallback if only embedding_painting_ids was saved
                self.entries = [
                    {"painting_id": pid, "orientation": 0}
                    for pid in meta.get("embedding_painting_ids", [])
                ]

            self.embeddings = loaded_emb.astype(np.float32)
            logger.info(
                f"Loaded {len(self.entries)} orientation embeddings across "
                f"{len(self.paintings)} paintings (dim={self.embeddings.shape[1]})."
            )
        else:
            self.embeddings = None
            self.entries = []
            logger.warning(
                f"Index files not found in {index_dir}. Run python scripts/build_index.py to generate embeddings."
            )

    def recognize(self, image_bytes: bytes) -> dict[str, Any]:
        if self.embeddings is None or len(self.entries) == 0:
            logger.warning("Recognition requested but index is empty.")
            return {
                "match": False,
                "painting_id": None,
                "orientation": None,
                "confidence": 0.0,
                "id": None,
                "title": None,
                "artist": None,
            }

        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        query_vec = self.encoder.encode(img)

        if self.embeddings.shape[1] != query_vec.shape[0]:
            logger.error(
                f"Embedding dimension mismatch: index has {self.embeddings.shape[1]}, "
                f"encoder produced {query_vec.shape[0]}. Re-run scripts/build_index.py."
            )
            return {
                "match": False,
                "painting_id": None,
                "orientation": None,
                "confidence": 0.0,
                "id": None,
                "title": None,
                "artist": None,
            }

        raw_sims = np.dot(self.embeddings, query_vec)

        # Group by (painting_id, orientation) since each orientation can have multiple reference photos
        best_per_key: dict[tuple[str, int], float] = {}
        for idx, entry in enumerate(self.entries):
            pid = str(entry["painting_id"])
            orientation = int(entry.get("orientation", 0))
            key = (pid, orientation)
            score = float(raw_sims[idx])
            if key not in best_per_key or score > best_per_key[key]:
                best_per_key[key] = score

        ranked = sorted(best_per_key.items(), key=lambda item: item[1], reverse=True)
        (best_pid, best_orient), best_score = ranked[0]
        (second_pid, second_orient), second_score = (
            ranked[1] if len(ranked) > 1 else (("none", 0), 0.0)
        )
        margin = best_score - second_score

        is_match = (
            best_score >= settings.similarity_threshold
            and margin >= settings.similarity_margin
        )

        logger.info(
            f"Recognize | top=({best_pid}, {best_orient}°) score={best_score:.4f} | "
            f"second=({second_pid}, {second_orient}°) score={second_score:.4f} | "
            f"margin={margin:.4f} (req>={settings.similarity_margin}) | "
            f"thresh={settings.similarity_threshold} -> match={is_match}"
        )

        if is_match:
            painting = self.paintings.get(best_pid, {})
            return {
                "match": True,
                "painting_id": best_pid,
                "orientation": best_orient,
                "confidence": round(best_score, 4),
                "pair_id": painting.get("pair_id", "pair-01-equinox"),
                "id": best_pid,
                "title": painting.get("title", "Unknown Title"),
                "artist": painting.get("artist", "Unknown Artist"),
            }

        return {
            "match": False,
            "painting_id": None,
            "orientation": None,
            "confidence": round(best_score, 4),
            "id": None,
            "title": None,
            "artist": None,
        }


recognizer = PaintingRecognizer()
