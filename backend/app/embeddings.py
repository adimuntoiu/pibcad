import logging
import numpy as np
from PIL import Image

from .config import settings

logger = logging.getLogger("painting_embeddings")


def compute_spatial_quadrant_descriptor(img: Image.Image) -> np.ndarray:
    """
    Computes an L2-normalized 256-dim descriptor combining:
    1) Global color/contrast identity (distinguishes Painting A vs Painting B).
    2) Zero-mean spatial 8x8 grid deviations (cancels radial symmetry so 0°, 90°, 180°, 270°
       rotations of the same painting are nearly orthogonal with a large cosine margin).
    """
    resized = img.convert("RGB").resize((128, 128), Image.Resampling.BILINEAR)
    arr = np.asarray(resized, dtype=np.float32) / 255.0

    r = arr[:, :, 0]
    g = arr[:, :, 1]
    b = arr[:, :, 2]
    rb = r - b
    rg = r - g
    gb = g - b
    gray = 0.299 * r + 0.587 * g + 0.114 * b

    gx = np.zeros_like(gray)
    gy = np.zeros_like(gray)
    gx[:, 1:-1] = gray[:, 2:] - gray[:, :-2]
    gy[1:-1, :] = gray[2:, :] - gray[:-2, :]

    # 1. Global painting identity signature (64 dims)
    hist_r, _ = np.histogram(r, bins=8, range=(0.0, 1.0), density=True)
    hist_g, _ = np.histogram(g, bins=8, range=(0.0, 1.0), density=True)
    hist_b, _ = np.histogram(b, bins=8, range=(0.0, 1.0), density=True)
    hist_rb, _ = np.histogram(rb, bins=16, range=(-1.0, 1.0), density=True)
    hist_rg, _ = np.histogram(rg, bins=12, range=(-1.0, 1.0), density=True)
    hist_gb, _ = np.histogram(gb, bins=12, range=(-1.0, 1.0), density=True)
    global_vec = np.concatenate([hist_r, hist_g, hist_b, hist_rb, hist_rg, hist_gb]).astype(
        np.float32
    )
    g_norm = float(np.linalg.norm(global_vec))
    if g_norm > 1e-8:
        global_vec = global_vec / g_norm

    # 2. Spatial 8x8 grid descriptor (64 cells x 3 channels = 192 dims), zero-mean across cells
    grid_n = 8
    cell_s = 128 // grid_n
    grid_feats = np.zeros((grid_n * grid_n, 3), dtype=np.float32)
    idx = 0
    for gy_i in range(grid_n):
        for gx_i in range(grid_n):
            y0, y1 = gy_i * cell_s, (gy_i + 1) * cell_s
            x0, x1 = gx_i * cell_s, (gx_i + 1) * cell_s
            grid_feats[idx, 0] = float(np.mean(r[y0:y1, x0:x1] - b[y0:y1, x0:x1]))
            grid_feats[idx, 1] = float(np.mean(g[y0:y1, x0:x1] - r[y0:y1, x0:x1]))
            grid_feats[idx, 2] = float(
                np.mean(gx[y0:y1, x0:x1]) - np.mean(gy[y0:y1, x0:x1])
            )
            idx += 1

    # Subtract spatial mean across all 64 cells so radial symmetry cancels out completely
    grid_feats = grid_feats - np.mean(grid_feats, axis=0, keepdims=True)
    spatial_vec = grid_feats.reshape(-1)
    s_norm = float(np.linalg.norm(spatial_vec))
    if s_norm > 1e-8:
        spatial_vec = spatial_vec / s_norm

    # Combine global identity (weight 0.65) and orientation-specific spatial layout (weight 0.76)
    combined = np.concatenate([global_vec * 0.65, spatial_vec * 0.76]).astype(np.float32)
    c_norm = float(np.linalg.norm(combined))
    if c_norm > 1e-8:
        combined = combined / c_norm
    return combined


class EmbeddingEncoder:
    """
    Swappable image embedding encoder supporting:
    - 'clip' (open_clip ViT-B-32 + orientation-sensitive quadrant descriptor)
    - 'dinov2' (facebookresearch/dinov2 + orientation-sensitive quadrant descriptor)
    - 'spatial' (fast CPU spatial color & gradient descriptor, also used as automatic fallback)
    """

    def __init__(self) -> None:
        self.requested_backbone = settings.embedding_backbone
        self.active_backbone = "spatial"
        self.device = "cpu"
        self.model = None
        self.preprocess = None

    def load(self) -> None:
        if self.requested_backbone == "spatial":
            self.active_backbone = "spatial"
            logger.info("Using 'spatial' orientation-aware embedding backbone on CPU.")
            return

        try:
            import torch

            self.device = "cuda" if torch.cuda.is_available() else "cpu"

            if self.requested_backbone == "dinov2":
                logger.info(f"Loading DINOv2 model ({settings.dinov2_model_name}) on {self.device}...")
                from torchvision import transforms

                self.model = torch.hub.load(
                    "facebookresearch/dinov2", settings.dinov2_model_name
                ).to(self.device)
                self.model.eval()
                self.preprocess = transforms.Compose(
                    [
                        transforms.Resize((224, 224)),
                        transforms.ToTensor(),
                        transforms.Normalize(
                            mean=(0.485, 0.456, 0.406), std=(0.229, 0.224, 0.225)
                        ),
                    ]
                )
                self.active_backbone = "dinov2"
                logger.info("DINOv2 backbone loaded.")
                return

            # Default: CLIP via open_clip
            import open_clip

            logger.info(
                f"Loading CLIP model {settings.clip_model_name} ({settings.clip_pretrained}) on {self.device}..."
            )
            self.model, _, self.preprocess = open_clip.create_model_and_transforms(
                settings.clip_model_name,
                pretrained=settings.clip_pretrained,
                device=self.device,
            )
            self.model.eval()
            self.active_backbone = "clip"
            logger.info("CLIP backbone loaded.")
        except Exception as exc:
            logger.warning(
                f"Could not initialize '{self.requested_backbone}' neural backbone ({exc}). "
                "Falling back to fast CPU 'spatial' orientation-aware embedding encoder."
            )
            self.model = None
            self.preprocess = None
            self.active_backbone = "spatial"

    def encode(self, img: Image.Image) -> np.ndarray:
        rgb = img.convert("RGB")
        spatial_vec = compute_spatial_quadrant_descriptor(rgb)

        if self.active_backbone in ("clip", "dinov2") and self.model is not None and self.preprocess is not None:
            import torch

            tensor = self.preprocess(rgb).unsqueeze(0).to(self.device)
            with torch.no_grad():
                if self.active_backbone == "clip":
                    feat = self.model.encode_image(tensor)
                else:
                    feat = self.model(tensor)
                feat = feat / feat.norm(dim=-1, keepdim=True)
                deep_vec = feat.cpu().numpy()[0].astype(np.float32)

            combined = np.concatenate([deep_vec * 0.65, spatial_vec * 0.76]).astype(np.float32)
            norm = float(np.linalg.norm(combined))
            if norm > 1e-8:
                combined = combined / norm
            return combined

        return spatial_vec
