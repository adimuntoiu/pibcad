import json
import os
import urllib.request

url = os.environ.get("PUBLIC_SUPABASE_URL", "https://vznrfywqybmdtqbqtfyl.supabase.co").rstrip("/")
key = os.environ.get("SUPABASE_SERVICE_KEY", "sb_secret_BFao3sKzpp7sheAlyvkXBQ_bHAYlwaS").strip()

headers = {
    "apikey": key,
}
if not key.startswith("sb_"):
    headers["Authorization"] = f"Bearer {key}"

def upload_storage(bucket, file_path, dest_name, content_type):
    with open(file_path, "rb") as f:
        data = f.read()
    dest_path = f"{url}/storage/v1/object/{bucket}/{dest_name}"
    h = dict(headers)
    h["Content-Type"] = content_type
    h["x-upsert"] = "true"
    req = urllib.request.Request(dest_path, data=data, headers=h, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            print(f"Uploaded to {bucket}/{dest_name}: {resp.status}")
    except Exception as e:
        print(f"Failed upload to {bucket}/{dest_name}: {e}")

def insert_painting():
    row = {
        "id": "irloAbstract2",
        "title": "IRLO Abstract II",
        "artist": "IRLO",
        "image_path": "irloAbstract2.jpeg"
    }
    h = dict(headers)
    h["Content-Type"] = "application/json"
    h["Prefer"] = "resolution=merge-duplicates"
    data = json.dumps(row).encode("utf-8")
    req = urllib.request.Request(f"{url}/rest/v1/paintings", data=data, headers=h, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            print(f"Upserted painting irloAbstract2: {resp.status}")
    except Exception as e:
        print(f"Failed to upsert painting: {e}")

if __name__ == "__main__":
    upload_storage("paintings", "backend/data/paintings/irloAbstract2.jpeg", "irloAbstract2.jpeg", "image/jpeg")
    upload_storage("artwork-images", "backend/data/paintings/irloAbstract2.jpeg", "irloAbstract2.jpeg", "image/jpeg")
    upload_storage("models", "static/demo/models/irloAbstract2.glb", "irloAbstract2.glb", "model/gltf-binary")
    insert_painting()
