from pathlib import Path
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

    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
