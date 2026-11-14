from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .recognizer import detector

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    detector.load()
    yield


app = FastAPI(title="Painting Detection API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "paintings": [r["id"] for r in detector.refs],
        "source": detector.source,
        "min_inliers": settings.min_inliers,
    }


@app.post("/api/recognize")
def recognize(file: UploadFile = File(...)):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Uploaded file must be an image")
    data = file.file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty image file")
    return detector.detect(data)
