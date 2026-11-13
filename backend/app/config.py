from pathlib import Path
from typing import Literal
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    similarity_threshold: float = 0.68
    similarity_margin: float = 0.04
    embedding_backbone: Literal["clip", "dinov2", "spatial"] = "clip"
    clip_model_name: str = "ViT-B-32"
    clip_pretrained: str = "laion2b_s34b_b79k"
    dinov2_model_name: str = "dinov2_vits14"
    data_dir: Path = BASE_DIR / "data"
    supabase_url: str = ""
    supabase_service_role_key: str = ""

    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
