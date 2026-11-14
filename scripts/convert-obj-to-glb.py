"""Convert an artist Wavefront OBJ (+ optional MTL + texture) to binary glTF 2.0 (.glb).

Features:
- Vectorized fast parsing for large scans (millions of triangles).
- Spatial voxel-grid decimation when face count exceeds `MAX_TRIS` (default 75,000),
  preserving UV seams and smooth vertex normals.
- Embeds diffuse texture (`map_Kd` from `.mtl` or matching `.png`/`.jpg` in the same folder)
  resized to <= 1024x1024 JPEG inside the GLB binary chunk.
- Outputs in canvas-width units: X/Y centered, max(width, height) = 1.0, min.z = 0.0 (+Z front).

Usage:
  backend/.venv/bin/python scripts/convert-obj-to-glb.py input.obj output.glb [max_tris]
"""

from __future__ import annotations

import io
import json
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image


def parse_mtl(mtl_path: Path, base_dir: Path) -> dict[str, dict]:
    mats: dict[str, dict] = {}
    if not mtl_path.exists():
        # Try matching .mtl in base_dir if mtllib filename was renamed
        alt = base_dir / f"{base_dir.name}.mtl"
        if alt.exists():
            mtl_path = alt
        else:
            candidates = list(base_dir.glob("*.mtl"))
            if candidates:
                mtl_path = candidates[0]
            else:
                return mats

    cur: str | None = None
    for raw in mtl_path.read_text(encoding="utf-8", errors="ignore").splitlines():
        parts = raw.strip().split()
        if not parts or parts[0].startswith("#"):
            continue
        if parts[0] == "newmtl" and len(parts) >= 2:
            cur = parts[1]
            mats[cur] = {"rgba": [0.85, 0.87, 0.90, 1.0], "tex": None}
        elif parts[0] == "Kd" and cur and len(parts) >= 4:
            mats[cur]["rgba"][:3] = [float(parts[1]), float(parts[2]), float(parts[3])]
        elif parts[0] == "d" and cur and len(parts) >= 2:
            mats[cur]["rgba"][3] = float(parts[1])
        elif parts[0] == "map_Kd" and cur and len(parts) >= 2:
            tex_tok = " ".join(parts[1:])
            mats[cur]["tex"] = tex_tok
    return mats


def find_texture_file(tex_name: str | None, obj_path: Path) -> Path | None:
    parent = obj_path.parent
    candidates: list[Path] = []
    if tex_name:
        candidates.append(parent / tex_name)
        candidates.append(parent / Path(tex_name).name)
    for ext in (".png", ".jpg", ".jpeg", ".webp"):
        candidates.append(parent / f"{obj_path.stem}{ext}")
    for c in candidates:
        if c.exists() and c.is_file():
            return c
    # Fallback: single image file next to the .obj
    for pattern in ("*.png", "*.jpg", "*.jpeg"):
        found = sorted(parent.glob(pattern))
        if found:
            return found[0]
    return None


def encode_texture_jpeg(tex_path: Path, max_dim: int = 1024) -> bytes:
    with Image.open(tex_path) as im:
        im = im.convert("RGB")
        if max(im.size) > max_dim:
            im.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=88, optimize=True)
        return buf.getvalue()


def _parse_obj_fast(
    obj_path: Path,
) -> tuple[
    np.ndarray,
    np.ndarray,
    np.ndarray,
    dict[str, tuple[np.ndarray, np.ndarray, np.ndarray]],
    dict[str, dict],
]:
    v_list: list[tuple[float, float, float]] = []
    vt_list: list[tuple[float, float]] = []
    vn_list: list[tuple[float, float, float]] = []

    mtl_info: dict[str, dict] = {}
    groups_v: dict[str, list[tuple[int, int, int]]] = {"default": []}
    groups_vt: dict[str, list[tuple[int, int, int]]] = {"default": []}
    groups_vn: dict[str, list[tuple[int, int, int]]] = {"default": []}
    active_mat = "default"

    with obj_path.open("r", encoding="utf-8", errors="ignore") as fh:
        for line in fh:
            if not line:
                continue
            c0 = line[0]
            if c0 == "v":
                c1 = line[1] if len(line) > 1 else ""
                if c1 == " ":
                    p = line.split()
                    v_list.append((float(p[1]), float(p[2]), float(p[3])))
                elif c1 == "t":
                    p = line.split()
                    vt_list.append((float(p[1]), float(p[2])))
                elif c1 == "n":
                    p = line.split()
                    vn_list.append((float(p[1]), float(p[2]), float(p[3])))
            elif c0 == "f" and len(line) > 2 and line[1] == " ":
                toks = line.split()[1:]
                nv = len(v_list)
                nvt = len(vt_list)
                nvn = len(vn_list)
                tri_v: list[int] = []
                tri_vt: list[int] = []
                tri_vn: list[int] = []
                for tok in toks:
                    if "/" in tok:
                        segs = tok.split("/")
                        iv = int(segs[0])
                        tri_v.append(nv + iv if iv < 0 else iv - 1)
                        if len(segs) > 1 and segs[1]:
                            ivt = int(segs[1])
                            tri_vt.append(nvt + ivt if ivt < 0 else ivt - 1)
                        else:
                            tri_vt.append(-1)
                        if len(segs) > 2 and segs[2]:
                            ivn = int(segs[2])
                            tri_vn.append(nvn + ivn if ivn < 0 else ivn - 1)
                        else:
                            tri_vn.append(-1)
                    else:
                        iv = int(tok)
                        tri_v.append(nv + iv if iv < 0 else iv - 1)
                        tri_vt.append(-1)
                        tri_vn.append(-1)

                gv = groups_v[active_mat]
                gvt = groups_vt[active_mat]
                gvn = groups_vn[active_mat]
                for k in range(1, len(tri_v) - 1):
                    gv.append((tri_v[0], tri_v[k], tri_v[k + 1]))
                    gvt.append((tri_vt[0], tri_vt[k], tri_vt[k + 1]))
                    gvn.append((tri_vn[0], tri_vn[k], tri_vn[k + 1]))
            elif line.startswith("mtllib "):
                mtl_name = line[7:].strip()
                mtl_info.update(parse_mtl(obj_path.parent / mtl_name, obj_path.parent))
            elif line.startswith("usemtl "):
                active_mat = line[7:].strip() or "default"
                groups_v.setdefault(active_mat, [])
                groups_vt.setdefault(active_mat, [])
                groups_vn.setdefault(active_mat, [])

    if not v_list:
        raise ValueError(f"No vertices found in {obj_path}")

    arr_v = np.asarray(v_list, dtype=np.float32)
    arr_vt = np.asarray(vt_list, dtype=np.float32) if vt_list else np.empty((0, 2), dtype=np.float32)
    arr_vn = np.asarray(vn_list, dtype=np.float32) if vn_list else np.empty((0, 3), dtype=np.float32)

    if not mtl_info and len(groups_v) == 1:
        # Check for sibling .mtl even if mtllib wasn't listed or didn't match
        mtl_info.update(parse_mtl(obj_path.with_suffix(".mtl"), obj_path.parent))

    packed_groups: dict[str, tuple[np.ndarray, np.ndarray, np.ndarray]] = {}
    for mat_name, fv in groups_v.items():
        if not fv:
            continue
        packed_groups[mat_name] = (
            np.asarray(fv, dtype=np.int32),
            np.asarray(groups_vt[mat_name], dtype=np.int32),
            np.asarray(groups_vn[mat_name], dtype=np.int32),
        )

    return arr_v, arr_vt, arr_vn, packed_groups, mtl_info


def _voxel_decimate_group(
    arr_v: np.ndarray,
    fv: np.ndarray,
    fvt: np.ndarray,
    fvn: np.ndarray,
    max_tris: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """
    Fast spatial voxel clustering when `len(fv) > max_tris`.
    Merges nearby vertices within a 3D cell and discards sub-voxel degenerate triangles.
    Returns `(new_v, fv_idx, fvt_idx, fvn_idx)` with updated position indices.
    """
    n_tris = len(fv)
    if n_tris <= max_tris:
        return arr_v, fv, fvt, fvn

    vmin = arr_v.min(axis=0)
    vmax = arr_v.max(axis=0)
    span = np.maximum(vmax - vmin, 1e-6)

    # Choose grid resolution proportional to aspect ratio targeting ~max_tris surviving triangles
    aspect = span / float(np.max(span))
    # Roughly estimate cell count along longest axis based on reduction ratio
    ratio = np.sqrt(max_tris / float(n_tris))
    # Empirical multiplier: a dense shell surface (~1.2M verts) fills ~20-30% of 2D projection
    grid_long = int(np.clip(round(190.0 * np.sqrt(max_tris / 75000.0)), 48, 360))
    # If vertex density is uniform volume or double-sided shell, tune conservatively
    if ratio < 0.25:
        grid_long = min(grid_long, 155)

    nx = max(12, int(round(grid_long * aspect[0])))
    ny = max(12, int(round(grid_long * aspect[1])))
    nz = max(8, int(round(grid_long * aspect[2])))

    rel = (arr_v - vmin) / span
    ix = np.clip((rel[:, 0] * (nx - 1)).astype(np.int64), 0, nx - 1)
    iy = np.clip((rel[:, 1] * (ny - 1)).astype(np.int64), 0, ny - 1)
    iz = np.clip((rel[:, 2] * (nz - 1)).astype(np.int64), 0, nz - 1)
    cell_key = (ix * ny + iy) * nz + iz

    uniq_cells, v_to_cell = np.unique(cell_key, return_inverse=True)
    n_cells = len(uniq_cells)

    # Average position of vertices inside each voxel cell
    cell_pos = np.zeros((n_cells, 3), dtype=np.float32)
    np.add.at(cell_pos, v_to_cell, arr_v)
    counts = np.bincount(v_to_cell, minlength=n_cells).astype(np.float32)[:, None]
    cell_pos /= np.maximum(counts, 1.0)

    c0 = v_to_cell[fv[:, 0]]
    c1 = v_to_cell[fv[:, 1]]
    c2 = v_to_cell[fv[:, 2]]
    keep = (c0 != c1) & (c1 != c2) & (c0 != c2)

    kept_fv = np.column_stack((c0[keep], c1[keep], c2[keep])).astype(np.int32)
    kept_fvt = fvt[keep]
    kept_fvn = fvn[keep]

    # Cap if still above max_tris by uniform stride
    if len(kept_fv) > max_tris:
        step = max(2, len(kept_fv) // max_tris + 1)
        # Re-cluster with coarser grid to preserve topological connectivity cleanly!
        coarser = int(round(grid_long * np.sqrt(max_tris / float(len(kept_fv))) * 0.92))
        coarser = max(24, coarser)
        nx = max(8, int(round(coarser * aspect[0])))
        ny = max(8, int(round(coarser * aspect[1])))
        nz = max(6, int(round(coarser * aspect[2])))
        ix = np.clip((rel[:, 0] * (nx - 1)).astype(np.int64), 0, nx - 1)
        iy = np.clip((rel[:, 1] * (ny - 1)).astype(np.int64), 0, ny - 1)
        iz = np.clip((rel[:, 2] * (nz - 1)).astype(np.int64), 0, nz - 1)
        cell_key = (ix * ny + iy) * nz + iz
        uniq_cells, v_to_cell = np.unique(cell_key, return_inverse=True)
        n_cells = len(uniq_cells)
        cell_pos = np.zeros((n_cells, 3), dtype=np.float32)
        np.add.at(cell_pos, v_to_cell, arr_v)
        counts = np.bincount(v_to_cell, minlength=n_cells).astype(np.float32)[:, None]
        cell_pos /= np.maximum(counts, 1.0)
        c0 = v_to_cell[fv[:, 0]]
        c1 = v_to_cell[fv[:, 1]]
        c2 = v_to_cell[fv[:, 2]]
        keep = (c0 != c1) & (c1 != c2) & (c0 != c2)
        kept_fv = np.column_stack((c0[keep], c1[keep], c2[keep])).astype(np.int32)
        kept_fvt = fvt[keep]
        kept_fvn = fvn[keep]

    return cell_pos, kept_fv, kept_fvt, kept_fvn


def obj_to_glb(obj_path: Path, glb_path: Path, max_tris: int = 75000) -> None:
    arr_v, arr_vt, arr_vn, packed_groups, mtl_info = _parse_obj_fast(obj_path)

    # Normalize overall object into canvas-width units: center X/Y, max(W, H) = 1.0, min.z = 0.0
    vmin = arr_v.min(axis=0)
    vmax = arr_v.max(axis=0)
    size = vmax - vmin
    span_xy = float(max(size[0], size[1]))
    scale = 1.0 / span_xy if span_xy > 1e-6 else 1.0
    center = (vmin + vmax) * 0.5
    arr_v = arr_v.copy()
    arr_v[:, 0] = (arr_v[:, 0] - center[0]) * scale
    arr_v[:, 1] = (arr_v[:, 1] - center[1]) * scale
    arr_v[:, 2] = (arr_v[:, 2] - vmin[2]) * scale

    bin_buf = bytearray()
    buffer_views: list[dict] = []
    accessors: list[dict] = []
    primitives: list[dict] = []
    materials: list[dict] = []
    images: list[dict] = []
    samplers: list[dict] = []
    textures: list[dict] = []
    tex_cache: dict[Path, int] = {}

    def append_bytes(raw_bytes: bytes, target: int | None) -> int:
        offset = len(bin_buf)
        bin_buf.extend(raw_bytes)
        while len(bin_buf) % 4 != 0:
            bin_buf.append(0)
        bv_idx = len(buffer_views)
        bv: dict = {"buffer": 0, "byteOffset": offset, "byteLength": len(raw_bytes)}
        if target is not None:
            bv["target"] = target
        buffer_views.append(bv)
        return bv_idx

    for mat_name, (fv, fvt, fvn) in packed_groups.items():
        if len(fv) == 0:
            continue

        mat_data = mtl_info.get(mat_name)
        if not mat_data and len(mtl_info) == 1:
            mat_data = next(iter(mtl_info.values()))
        rgba = mat_data["rgba"] if mat_data else [0.85, 0.87, 0.90, 1.0]
        tex_hint = mat_data["tex"] if mat_data else None
        tex_file = find_texture_file(tex_hint, obj_path)

        pos_src, tri_v, tri_vt, tri_vn = _voxel_decimate_group(arr_v, fv, fvt, fvn, max_tris)
        if len(tri_v) == 0:
            continue

        # Gather per-corner attributes vectorized
        corner_v = tri_v.reshape(-1)
        pos_corners = pos_src[corner_v]

        has_uv = len(arr_vt) > 0 and np.any(tri_vt >= 0)
        if has_uv:
            safe_vt = np.maximum(tri_vt.reshape(-1), 0)
            uv_corners = arr_vt[safe_vt].copy()
            # glTF 2.0 UV origin is top-left (V flipped relative to Wavefront OBJ)
            uv_corners[:, 1] = 1.0 - uv_corners[:, 1]
        else:
            uv_corners = None

        # Always compute clean geometric normals vectorized (more robust after decimation)
        a = pos_src[tri_v[:, 0]]
        b = pos_src[tri_v[:, 1]]
        c = pos_src[tri_v[:, 2]]
        face_n = np.cross(b - a, c - a)
        face_norm = np.linalg.norm(face_n, axis=1, keepdims=True)
        valid_f = (face_norm[:, 0] > 1e-10)
        if not np.any(valid_f):
            continue
        if not np.all(valid_f):
            tri_v = tri_v[valid_f]
            face_n = face_n[valid_f]
            face_norm = face_norm[valid_f]
            pos_corners = pos_src[tri_v.reshape(-1)]
            if uv_corners is not None:
                uv_corners = uv_corners.reshape(-1, 3, 2)[valid_f].reshape(-1, 2)

        unit_fn = (face_n / face_norm).astype(np.float32)
        nrm_corners = np.repeat(unit_fn, 3, axis=0)

        # Deduplicate exact (position_index, quantized_uv, quantized_normal) corners for compact indexed mesh
        q_pos = corner_v = tri_v.reshape(-1)
        if uv_corners is not None:
            q_u = np.round(uv_corners[:, 0] * 4096.0).astype(np.int64)
            q_v = np.round(uv_corners[:, 1] * 4096.0).astype(np.int64)
            # Hash into structured void array to find unique vertices cleanly
            keys = np.empty(
                len(q_pos), dtype=[("p", np.int32), ("u", np.int32), ("v", np.int32)]
            )
            keys["p"] = q_pos
            keys["u"] = q_u
            keys["v"] = q_v
            _, uniq_first, inv_idx = np.unique(keys, return_index=True, return_inverse=True)
            pos = pos_corners[uniq_first].astype(np.float32)
            uv = uv_corners[uniq_first].astype(np.float32)
            # Average normals smoothly across shared unique corners!
            nrm = np.zeros_like(pos, dtype=np.float32)
            np.add.at(nrm, inv_idx, nrm_corners)
            nrm_len = np.linalg.norm(nrm, axis=1, keepdims=True)
            nrm = np.where(nrm_len > 1e-8, nrm / np.maximum(nrm_len, 1e-8), np.array([0.0, 0.0, 1.0], dtype=np.float32))
            idx = inv_idx.astype(np.uint32)
        else:
            uniq_pos_idx, uniq_first, inv_idx = np.unique(q_pos, return_index=True, return_inverse=True)
            pos = pos_src[uniq_pos_idx].astype(np.float32)
            nrm = np.zeros_like(pos, dtype=np.float32)
            np.add.at(nrm, inv_idx, nrm_corners)
            nrm_len = np.linalg.norm(nrm, axis=1, keepdims=True)
            nrm = np.where(nrm_len > 1e-8, nrm / np.maximum(nrm_len, 1e-8), np.array([0.0, 0.0, 1.0], dtype=np.float32))
            uv = None
            idx = inv_idx.astype(np.uint32)

        mat_def: dict = {
            "name": mat_name,
            "pbrMetallicRoughness": {
                "baseColorFactor": [1.0, 1.0, 1.0, float(rgba[3])] if tex_file and uv is not None else [float(x) for x in rgba],
                "metallicFactor": 0.15 if tex_file else 0.3,
                "roughnessFactor": 0.55 if tex_file else 0.35,
            },
            "doubleSided": True,
        }

        if tex_file and uv is not None:
            if tex_file not in tex_cache:
                jpeg_bytes = encode_texture_jpeg(tex_file, max_dim=1024)
                bv_img = append_bytes(jpeg_bytes, None)
                img_idx = len(images)
                images.append({"bufferView": bv_img, "mimeType": "image/jpeg"})
                if not samplers:
                    samplers.append({"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497})
                tex_idx = len(textures)
                textures.append({"sampler": 0, "source": img_idx})
                tex_cache[tex_file] = tex_idx
            mat_def["pbrMetallicRoughness"]["baseColorTexture"] = {"index": tex_cache[tex_file]}

        mat_idx = len(materials)
        materials.append(mat_def)

        bv_pos = append_bytes(pos.tobytes(), 34962)
        bv_nrm = append_bytes(nrm.tobytes(), 34962)
        bv_idx = append_bytes(idx.tobytes(), 34963)

        acc_pos = len(accessors)
        accessors.append(
            {
                "bufferView": bv_pos,
                "componentType": 5126,
                "count": int(len(pos)),
                "type": "VEC3",
                "min": [float(x) for x in pos.min(axis=0)],
                "max": [float(x) for x in pos.max(axis=0)],
            }
        )
        acc_nrm = len(accessors)
        accessors.append(
            {"bufferView": bv_nrm, "componentType": 5126, "count": int(len(nrm)), "type": "VEC3"}
        )
        attrs: dict[str, int] = {"POSITION": acc_pos, "NORMAL": acc_nrm}

        if uv is not None:
            bv_uv = append_bytes(uv.tobytes(), 34962)
            acc_uv = len(accessors)
            accessors.append(
                {"bufferView": bv_uv, "componentType": 5126, "count": int(len(uv)), "type": "VEC2"}
            )
            attrs["TEXCOORD_0"] = acc_uv

        acc_idx = len(accessors)
        accessors.append(
            {"bufferView": bv_idx, "componentType": 5125, "count": int(len(idx)), "type": "SCALAR"}
        )
        primitives.append({"attributes": attrs, "indices": acc_idx, "material": mat_idx})

    gltf: dict = {
        "asset": {"version": "2.0", "generator": "pibcad-convert-obj-to-glb"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"name": obj_path.stem, "mesh": 0}],
        "meshes": [{"name": obj_path.stem, "primitives": primitives}],
        "materials": materials,
        "buffers": [{"byteLength": len(bin_buf)}],
        "bufferViews": buffer_views,
        "accessors": accessors,
    }
    if images:
        gltf["images"] = images
    if samplers:
        gltf["samplers"] = samplers
    if textures:
        gltf["textures"] = textures

    json_bytes = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    while len(json_bytes) % 4 != 0:
        json_bytes += b" "

    total_len = 12 + 8 + len(json_bytes) + 8 + len(bin_buf)
    glb_bytes = (
        struct.pack("<III", 0x46546C67, 2, total_len)
        + struct.pack("<II", len(json_bytes), 0x4E4F534A)
        + json_bytes
        + struct.pack("<II", len(bin_buf), 0x004E4942)
        + bytes(bin_buf)
    )
    glb_path.parent.mkdir(parents=True, exist_ok=True)
    glb_path.write_bytes(glb_bytes)
    print(
        f"Converted {obj_path} -> {glb_path} "
        f"({len(glb_bytes)} bytes, primitives={len(primitives)}, textured={bool(images)})"
    )


def scan_and_convert_data_models() -> None:
    root = Path(__file__).resolve().parent.parent
    data_dirs = [root / "data" / "models", root / "backend" / "data" / "models"]
    out_dir = root / "static" / "demo" / "models"
    out_dir.mkdir(parents=True, exist_ok=True)

    name_map = {
        "aa": "combined_AA.glb",
        "bb": "combined_BB.glb",
        "cc": "combined_CC.glb",
        "dd": "combined_DD.glb",
        "seam-aa": "combined_AA.glb",
        "seam-bb": "combined_BB.glb",
        "seam-cc": "combined_CC.glb",
        "seam-dd": "combined_DD.glb",
        "combined_aa": "combined_AA.glb",
        "combined_bb": "combined_BB.glb",
        "combined_cc": "combined_CC.glb",
        "combined_dd": "combined_DD.glb",
        "irloaa": "combined_AA.glb",
        "irlobb": "combined_BB.glb",
        "irlocc": "combined_CC.glb",
        "irlodd": "combined_DD.glb",
        "irlo1": "irlo1_single.glb",
        "irlo2": "irlo2_single.glb",
    }

    found = False
    for d in data_dirs:
        if not d.exists():
            continue
        # Scan for obj files
        for obj_file in d.rglob("*.obj"):
            stem = obj_file.stem.lower()
            target_name = name_map.get(stem)
            if target_name:
                dst = out_dir / target_name
                print(f"Syncing model: {obj_file} -> {dst}")
                obj_to_glb(obj_file, dst)
                found = True
        # Scan for glb files
        for glb_file in d.rglob("*.glb"):
            stem = glb_file.stem.lower()
            target_name = name_map.get(stem)
            if target_name:
                dst = out_dir / target_name
                if glb_file.resolve() != dst.resolve():
                    print(f"Copying GLB model: {glb_file} -> {dst}")
                    dst.write_bytes(glb_file.read_bytes())
                    found = True
    if not found:
        print("No matching models found in data/models yet.")


def main() -> None:
    if "--scan" in sys.argv or "--sync" in sys.argv:
        scan_and_convert_data_models()
        return

    if len(sys.argv) < 3:
        # Default behavior: run scan_and_convert then default fallback
        scan_and_convert_data_models()
        src = Path(__file__).resolve().parent.parent / "static" / "models" / "default.obj"
        dst = Path(__file__).resolve().parent.parent / "static" / "demo" / "models" / "default.glb"
        max_tris = 75000
    else:
        src = Path(sys.argv[1])
        dst = Path(sys.argv[2])
        max_tris = int(sys.argv[3]) if len(sys.argv) > 3 else 75000
    if src.exists():
        obj_to_glb(src, dst, max_tris=max_tris)


if __name__ == "__main__":
    main()
