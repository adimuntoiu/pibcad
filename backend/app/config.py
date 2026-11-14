from pathlib import Path
from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    # Minimum RANSAC inliers (matching feature points) to accept a painting.
    min_inliers: int = 15
    # Lowe ratio test for feature matching (lower = stricter).
    ratio_test: float = 0.75
    # Camera frames are downscaled so the longest side is at most this many px.
    frame_max_side: int = 640
    # Reference images are downscaled to this longest side before indexing.
    reference_max_side: int = 800
    data_dir: Path = BASE_DIR / "data"

    # Supabase (optional). When URL + key are set, paintings are loaded from the
    # `paintings` table and the storage bucket; otherwise the local
    # data/paintings.json catalog is used. Local files are also the fallback
    # if Supabase is unreachable.
    supabase_url: str = ""
    # Accepts SUPABASE_SERVICE_KEY or SUPABASE_SECKEY (new `sb_secret_...` or legacy JWT key)
    supabase_service_key: str = Field(
        default="", validation_alias=AliasChoices("SUPABASE_SERVICE_KEY", "SUPABASE_SECKEY")
    )
    supabase_bucket: str = "paintings"
    supabase_table: str = "paintings"
    supabase_timeout_s: float = 10.0

    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def supabase_enabled(self) -> bool:
        return bool(self.supabase_url.strip() and self.supabase_service_key.strip())


settings = Settings()
