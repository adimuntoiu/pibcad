from contextlib import asynccontextmanager
import logging
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import settings
from .recognizer import recognizer

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    recognizer.load()
    yield


app = FastAPI(title="Paired Canvas AR Recognition API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

paintings_dir = settings.data_dir / "paintings"
paintings_dir.mkdir(parents=True, exist_ok=True)
app.mount("/api/images", StaticFiles(directory=paintings_dir), name="images")


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "backbone": recognizer.encoder.active_backbone,
        "indexed_embeddings": len(recognizer.entries),
        "paintings_count": len(recognizer.paintings),
        "threshold": settings.similarity_threshold,
        "margin": settings.similarity_margin,
    }


@app.post("/api/reload")
async def reload_index():
    info = recognizer.reload()
    return {"status": "reloaded", **info}


@app.get("/api/paintings/{painting_id}")
async def get_painting(painting_id: str):
    painting = recognizer.paintings.get(painting_id)
    if not painting:
        raise HTTPException(status_code=404, detail="Painting not found")
    return {
        **painting,
        "imageUrl": "/api/images/" + painting["image"] if "image" in painting else None,
    }


@app.post("/api/recognize")
async def recognize_painting(file: UploadFile = File(...)):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Uploaded file must be an image")
    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Empty image file")

    try:
        result = recognizer.recognize(image_bytes)
        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Inference error: " + str(exc)) from exc
