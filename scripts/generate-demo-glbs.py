"""Procedurally generate binary glTF 2.0 (.glb) demo models in canvas-width units.

Coordinate system for every model (aligned to the canvas local frame):
  X: -0.5 .. +0.5 across canvas width (Edge C -> Edge B)
  Y: -0.5 .. +0.5 across canvas height (Edge D -> Edge A, so +Y points to Edge A)
  Z: >= 0 pops out in front of the painting toward the viewer
"""

from __future__ import annotations

import json
import math
import struct
from pathlib import Path

import numpy as np

OUT_DIR = Path(__file__).resolve().parent.parent / "static" / "demo" / "models"


class MeshBuilder:
    """Builds flat-shaded triangle meshes and packs them into glTF 2.0 GLB bytes."""

    def __init__(self, name: str) -> None:
        self.name = name
        self.materials: list[dict] = []
        self.primitives_data: list[tuple[np.ndarray, np.ndarray, np.ndarray, int]] = []

    def add_material(
        self,
        name: str,
        rgba: tuple[float, float, float, float],
        metallic: float = 0.25,
        roughness: float = 0.35,
        emissive: tuple[float, float, float] = (0.0, 0.0, 0.0),
    ) -> int:
        idx = len(self.materials)
        mat: dict = {
            "name": name,
            "pbrMetallicRoughness": {
                "baseColorFactor": [float(c) for c in rgba],
                "metallicFactor": float(metallic),
                "roughnessFactor": float(roughness),
            },
            "doubleSided": True,
        }
        if any(e > 0 for e in emissive):
            mat["emissiveFactor"] = [float(e) for e in emissive]
        self.materials.append(mat)
        return idx

    def _add_tris(self, tris: list[tuple[np.ndarray, np.ndarray, np.ndarray]], mat_idx: int) -> None:
        positions: list[np.ndarray] = []
        normals: list[np.ndarray] = []
        indices: list[int] = []
        for a, b, c in tris:
            n = np.cross(b - a, c - a)
            norm = float(np.linalg.norm(n))
            if norm < 1e-8:
                continue
            n = (n / norm).astype(np.float32)
            base = len(positions)
            positions.extend([a.astype(np.float32), b.astype(np.float32), c.astype(np.float32)])
            normals.extend([n, n, n])
            indices.extend([base, base + 1, base + 2])
        if not positions:
            return
        self.primitives_data.append(
            (
                np.vstack(positions).astype(np.float32),
                np.vstack(normals).astype(np.float32),
                np.array(indices, dtype=np.uint32),
                mat_idx,
            )
        )

    def add_box(
        self,
        center: tuple[float, float, float],
        size: tuple[float, float, float],
        mat_idx: int,
        rot_z: float = 0.0,
        rot_x: float = 0.0,
    ) -> None:
        hx, hy, hz = size[0] * 0.5, size[1] * 0.5, size[2] * 0.5
        raw = np.array(
            [
                [-hx, -hy, -hz],
                [hx, -hy, -hz],
                [hx, hy, -hz],
                [-hx, hy, -hz],
                [-hx, -hy, hz],
                [hx, -hy, hz],
                [hx, hy, hz],
                [-hx, hy, hz],
            ],
            dtype=np.float32,
        )
        v = _transform_pts(raw, center, rot_x=rot_x, rot_z=rot_z)
        quads = [
            (0, 3, 2, 1),
            (4, 5, 6, 7),
            (0, 1, 5, 4),
            (2, 3, 7, 6),
            (0, 4, 7, 3),
            (1, 2, 6, 5),
        ]
        tris = []
        for i0, i1, i2, i3 in quads:
            tris.append((v[i0], v[i1], v[i2]))
            tris.append((v[i0], v[i2], v[i3]))
        self._add_tris(tris, mat_idx)

    def add_frustum_z(
        self,
        center: tuple[float, float, float],
        r_bot: float,
        r_top: float,
        height_z: float,
        sides: int,
        mat_idx: int,
        twist_rad: float = 0.0,
        rot_z: float = 0.0,
    ) -> None:
        z0 = -height_z * 0.5
        z1 = height_z * 0.5
        ring0 = []
        ring1 = []
        for i in range(sides):
            a0 = 2.0 * math.pi * i / sides
            a1 = a0 + twist_rad
            ring0.append(np.array([r_bot * math.cos(a0), r_bot * math.sin(a0), z0], dtype=np.float32))
            ring1.append(np.array([r_top * math.cos(a1), r_top * math.sin(a1), z1], dtype=np.float32))
        pts = _transform_pts(
            np.vstack(ring0 + ring1 + [np.array([0, 0, z0]), np.array([0, 0, z1])]),
            center,
            rot_z=rot_z,
        )
        b_pts = pts[:sides]
        t_pts = pts[sides : 2 * sides]
        b_ctr = pts[2 * sides]
        t_ctr = pts[2 * sides + 1]
        tris = []
        for i in range(sides):
            j = (i + 1) % sides
            tris.append((b_pts[i], b_pts[j], t_pts[j]))
            tris.append((b_pts[i], t_pts[j], t_pts[i]))
            tris.append((b_ctr, b_pts[j], b_pts[i]))
            if r_top > 1e-4:
                tris.append((t_ctr, t_pts[i], t_pts[j]))
        self._add_tris(tris, mat_idx)

    def add_arrow_y(self, base: tuple[float, float, float], scale: float, mat_idx: int) -> None:
        """Adds an unmistakable directional chevron/fin pointing strictly toward +Y (Edge A)."""
        s = scale
        pts_local = np.array(
            [
                [0.0, 0.24 * s, 0.04 * s],   # 0: tip (+Y)
                [-0.12 * s, 0.0, 0.0],       # 1: left base
                [0.12 * s, 0.0, 0.0],        # 2: right base
                [0.0, 0.05 * s, 0.14 * s],   # 3: dorsal ridge (+Z)
                [0.0, 0.0, -0.02 * s],       # 4: bottom center
            ],
            dtype=np.float32,
        )
        v = _transform_pts(pts_local, base)
        tris = [
            (v[0], v[3], v[2]),
            (v[0], v[1], v[3]),
            (v[1], v[2], v[3]),
            (v[0], v[2], v[4]),
            (v[0], v[4], v[1]),
            (v[1], v[4], v[2]),
        ]
        self._add_tris(tris, mat_idx)

    def to_glb_bytes(self) -> bytes:
        bin_buf = bytearray()
        buffer_views: list[dict] = []
        accessors: list[dict] = []
        primitives: list[dict] = []

        def append_chunk(arr: np.ndarray, target: int) -> int:
            raw = arr.tobytes()
            offset = len(bin_buf)
            bin_buf.extend(raw)
            while len(bin_buf) % 4 != 0:
                bin_buf.append(0)
            bv_idx = len(buffer_views)
            buffer_views.append(
                {
                    "buffer": 0,
                    "byteOffset": offset,
                    "byteLength": len(raw),
                    "target": target,
                }
            )
            return bv_idx

        for pos, nrm, idx, mat_idx in self.primitives_data:
            bv_pos = append_chunk(pos, 34962)  # ARRAY_BUFFER
            bv_nrm = append_chunk(nrm, 34962)
            bv_idx = append_chunk(idx, 34963)  # ELEMENT_ARRAY_BUFFER

            acc_pos = len(accessors)
            accessors.append(
                {
                    "bufferView": bv_pos,
                    "componentType": 5126,  # FLOAT
                    "count": int(len(pos)),
                    "type": "VEC3",
                    "min": [float(v) for v in pos.min(axis=0)],
                    "max": [float(v) for v in pos.max(axis=0)],
                }
            )
            acc_nrm = len(accessors)
            accessors.append(
                {
                    "bufferView": bv_nrm,
                    "componentType": 5126,
                    "count": int(len(nrm)),
                    "type": "VEC3",
                }
            )
            acc_idx = len(accessors)
            accessors.append(
                {
                    "bufferView": bv_idx,
                    "componentType": 5125,  # UNSIGNED_INT
                    "count": int(len(idx)),
                    "type": "SCALAR",
                }
            )
            primitives.append(
                {
                    "attributes": {"POSITION": acc_pos, "NORMAL": acc_nrm},
                    "indices": acc_idx,
                    "material": mat_idx,
                }
            )

        gltf = {
            "asset": {"version": "2.0", "generator": "pibcad-generate-demo-glbs"},
            "scene": 0,
            "scenes": [{"nodes": [0]}],
            "nodes": [{"name": self.name, "mesh": 0}],
            "meshes": [{"name": self.name, "primitives": primitives}],
            "materials": self.materials,
            "buffers": [{"byteLength": len(bin_buf)}],
            "bufferViews": buffer_views,
            "accessors": accessors,
        }

        json_bytes = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
        while len(json_bytes) % 4 != 0:
            json_bytes += b" "

        total_len = 12 + 8 + len(json_bytes) + 8 + len(bin_buf)
        header = struct.pack("<III", 0x46546C67, 2, total_len)
        json_hdr = struct.pack("<II", len(json_bytes), 0x4E4F534A)
        bin_hdr = struct.pack("<II", len(bin_buf), 0x004E4942)
        return header + json_hdr + json_bytes + bin_hdr + bytes(bin_buf)


def _transform_pts(
    pts: np.ndarray,
    center: tuple[float, float, float],
    rot_x: float = 0.0,
    rot_z: float = 0.0,
) -> np.ndarray:
    res = pts.copy()
    if abs(rot_x) > 1e-6:
        cx, sx = math.cos(rot_x), math.sin(rot_x)
        rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]], dtype=np.float32)
        res = res @ rx.T
    if abs(rot_z) > 1e-6:
        cz, sz = math.cos(rot_z), math.sin(rot_z)
        rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]], dtype=np.float32)
        res = res @ rz.T
    return res + np.array(center, dtype=np.float32)


def build_irlo1() -> MeshBuilder:
    m = MeshBuilder("irlo1_single")
    mat_emerald = m.add_material("EmeraldCrystal", (0.06, 0.78, 0.56, 1.0), metallic=0.35, roughness=0.22)
    mat_dark = m.add_material("BasaltBase", (0.12, 0.16, 0.20, 1.0), metallic=0.6, roughness=0.4)
    mat_gold = m.add_material(
        "GoldEdgeA", (0.98, 0.78, 0.18, 1.0), metallic=0.75, roughness=0.2, emissive=(0.18, 0.12, 0.02)
    )
    # Pedestal plate resting just above the painting plane
    m.add_frustum_z((0.0, 0.0, 0.03), 0.36, 0.32, 0.05, 8, mat_dark)
    # Central faceted emerald obelisk rising along +Z
    m.add_frustum_z((0.0, 0.0, 0.30), 0.22, 0.02, 0.52, 6, mat_emerald, twist_rad=math.pi / 6)
    # Floating orbital ring
    m.add_box((0.0, 0.0, 0.24), (0.56, 0.04, 0.04), mat_emerald, rot_z=math.pi / 4)
    m.add_box((0.0, 0.0, 0.24), (0.56, 0.04, 0.04), mat_emerald, rot_z=-math.pi / 4)
    # Gold directional indicator pointing toward Edge A (+Y)
    m.add_arrow_y((0.0, 0.22, 0.06), 1.0, mat_gold)
    return m


def build_irlo2() -> MeshBuilder:
    m = MeshBuilder("irlo2_single")
    mat_amber = m.add_material("AmberSpire", (0.96, 0.45, 0.14, 1.0), metallic=0.3, roughness=0.25)
    mat_slate = m.add_material("SlateFrame", (0.15, 0.14, 0.19, 1.0), metallic=0.55, roughness=0.45)
    mat_sky = m.add_material(
        "SkyEdgeA", (0.22, 0.74, 0.98, 1.0), metallic=0.65, roughness=0.2, emissive=(0.04, 0.14, 0.22)
    )
    m.add_box((0.0, 0.0, 0.03), (0.64, 0.64, 0.04), mat_slate)
    m.add_frustum_z((0.0, 0.0, 0.22), 0.20, 0.14, 0.34, 4, mat_amber, twist_rad=math.pi / 4)
    m.add_frustum_z((0.0, 0.0, 0.46), 0.14, 0.01, 0.22, 4, mat_amber, twist_rad=math.pi / 4, rot_z=math.pi / 4)
    # Sky-blue directional fin pointing toward Edge A (+Y)
    m.add_arrow_y((0.0, 0.22, 0.06), 1.0, mat_sky)
    return m


def build_combined_aa() -> MeshBuilder:
    m = MeshBuilder("combined_AA")
    mat_violet = m.add_material("VioletArch", (0.55, 0.36, 0.96, 1.0), metallic=0.35, roughness=0.25)
    mat_gold = m.add_material("GoldKeystone", (0.98, 0.78, 0.20, 1.0), metallic=0.8, roughness=0.2)
    # Twin pillars spanning seam X=[-0.55..+0.55]
    m.add_box((-0.42, 0.0, 0.26), (0.16, 0.28, 0.50), mat_violet)
    m.add_box((0.42, 0.0, 0.26), (0.16, 0.28, 0.50), mat_violet)
    # Overhead bridge beam + gold keystone centered at seam
    m.add_box((0.0, 0.0, 0.52), (1.05, 0.24, 0.14), mat_violet)
    m.add_frustum_z((0.0, 0.0, 0.62), 0.18, 0.04, 0.24, 8, mat_gold)
    m.add_arrow_y((0.0, 0.15, 0.58), 0.7, mat_gold)
    return m


def build_combined_bb() -> MeshBuilder:
    m = MeshBuilder("combined_BB")
    mat_cyan = m.add_material("CyanHelix", (0.08, 0.78, 0.92, 1.0), metallic=0.4, roughness=0.2)
    mat_emerald = m.add_material("EmeraldCore", (0.16, 0.85, 0.55, 1.0), metallic=0.5, roughness=0.25)
    for step in range(8):
        t = step / 7.0
        angle = t * math.pi * 1.5
        z = 0.08 + t * 0.56
        dx = 0.28 * math.cos(angle)
        dy = 0.18 * math.sin(angle)
        m.add_box((dx, dy, z), (0.18, 0.12, 0.07), mat_cyan, rot_z=angle)
        m.add_box((-dx, -dy, z), (0.18, 0.12, 0.07), mat_emerald, rot_z=angle)
    m.add_frustum_z((0.0, 0.0, 0.34), 0.08, 0.08, 0.64, 10, mat_emerald)
    return m


def build_combined_cc() -> MeshBuilder:
    m = MeshBuilder("combined_CC")
    mat_crimson = m.add_material("CrimsonPortal", (0.92, 0.22, 0.32, 1.0), metallic=0.35, roughness=0.28)
    mat_orange = m.add_material("AmberFlame", (0.98, 0.58, 0.14, 1.0), metallic=0.6, roughness=0.22)
    m.add_box((-0.36, 0.0, 0.28), (0.18, 0.18, 0.54), mat_crimson, rot_x=0.12)
    m.add_box((0.36, 0.0, 0.28), (0.18, 0.18, 0.54), mat_crimson, rot_x=-0.12)
    m.add_box((0.0, 0.0, 0.54), (0.92, 0.22, 0.12), mat_crimson)
    m.add_frustum_z((0.0, 0.0, 0.28), 0.16, 0.16, 0.14, 6, mat_orange)
    return m


def build_combined_dd() -> MeshBuilder:
    m = MeshBuilder("combined_DD")
    mat_blue = m.add_material("RoyalBlue", (0.22, 0.44, 0.96, 1.0), metallic=0.45, roughness=0.25)
    mat_silver = m.add_material("SilverCrown", (0.85, 0.89, 0.95, 1.0), metallic=0.85, roughness=0.18)
    m.add_frustum_z((0.0, 0.0, 0.04), 0.52, 0.48, 0.06, 12, mat_blue)
    for i in range(6):
        ang = 2.0 * math.pi * i / 6
        px, py = 0.34 * math.cos(ang), 0.22 * math.sin(ang)
        m.add_frustum_z((px, py, 0.28), 0.09, 0.01, 0.44, 4, mat_silver, rot_z=ang)
    m.add_frustum_z((0.0, 0.0, 0.42), 0.18, 0.02, 0.28, 8, mat_blue)
    return m


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    specs = [
        ("irlo1_single.glb", build_irlo1()),
        ("irlo2_single.glb", build_irlo2()),
        ("combined_AA.glb", build_combined_aa()),
        ("combined_BB.glb", build_combined_bb()),
        ("combined_CC.glb", build_combined_cc()),
        ("combined_DD.glb", build_combined_dd()),
    ]
    for filename, builder in specs:
        out_path = OUT_DIR / filename
        data = builder.to_glb_bytes()
        out_path.write_bytes(data)
        print(f"Generated {out_path} ({len(data)} bytes)")


if __name__ == "__main__":
    main()
