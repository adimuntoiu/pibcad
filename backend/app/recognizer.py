import json
import logging
from typing import Any

import cv2
import numpy as np

from .config import settings

logger = logging.getLogger("painting_detector")


def _resize_long_side(img: np.ndarray, max_side: int) -> tuple[np.ndarray, float]:
    h, w = img.shape[:2]
    scale = min(1.0, max_side / max(h, w))
    if scale < 1.0:
        img = cv2.resize(img, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)
    return img, scale


def _order_quad_corners(pts: np.ndarray) -> np.ndarray:
    """
    Orders any 4 convex quad vertices strictly clockwise around their centroid.
    Works at every continuous rotation angle (0°..360°, including 45° diamond tilt)
    without vertex collisions or bowtie self-intersections.
    """
    center = pts.mean(axis=0)
    angles = np.arctan2(pts[:, 1] - center[1], pts[:, 0] - center[0])
    order = np.argsort(angles)
    ordered = pts[order].astype(np.float32)
    start = int(np.argmin(ordered[:, 1] + 0.5 * ordered[:, 0]))
    return np.roll(ordered, -start, axis=0)


def _rootsift(des: np.ndarray | None) -> np.ndarray | None:
    """
    Converts SIFT descriptors to L2-normalized RootSIFT (Hellinger kernel).
    Dramatically improves matching under perspective tilt, blur, and lighting shifts,
    and allows fast BLAS matrix-multiply nearest-neighbor search.
    """
    if des is None or len(des) == 0:
        return None
    l1 = des / (np.sum(des, axis=1, keepdims=True) + 1e-7)
    root = np.sqrt(l1).astype(np.float32)
    norms = np.linalg.norm(root, axis=1, keepdims=True) + 1e-7
    return root / norms


def _build_asift_bank(gray_ref: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """
    Builds a multi-scale + affine perspective-tilted (ASIFT) RootSIFT keypoint bank
    for a reference painting at startup.
    Includes smoothed coarse/medium scales (so distant or blurry webcam views match)
    and X, Y, and ±45° diagonal foreshortened views (so 3D camera tilts up to ~55° match).
    """
    h, w = gray_ref.shape[:2]
    sift_iso = cv2.SIFT_create(nfeatures=320, contrastThreshold=0.022, edgeThreshold=12)
    sift_tilt = cv2.SIFT_create(nfeatures=220, contrastThreshold=0.022, edgeThreshold=12)

    pts_all: list[np.ndarray] = []
    des_all: list[np.ndarray] = []

    # 1. Multi-scale isotropic pyramid (from medium-fine down to 68px distant view)
    for scale in (0.68, 0.40, 0.24, 0.14):
        sw, sh = max(32, round(w * scale)), max(32, round(h * scale))
        im = cv2.resize(gray_ref, (sw, sh), interpolation=cv2.INTER_AREA)
        im = cv2.GaussianBlur(im, (3, 3), 0.65)
        kps, des = sift_iso.detectAndCompute(im, None)
        rdes = _rootsift(des)
        if rdes is not None and kps:
            pts = np.float32([k.pt for k in kps]) * np.float32([w / sw, h / sh])
            pts_all.append(pts)
            des_all.append(rdes)

    # 2. Axis-aligned foreshortened (3D tilted) views along X and Y
    for sx, sy in ((0.42, 0.25), (0.25, 0.42), (0.28, 0.16), (0.16, 0.28)):
        sw, sh = max(32, round(w * sx)), max(32, round(h * sy))
        im = cv2.resize(gray_ref, (sw, sh), interpolation=cv2.INTER_AREA)
        im = cv2.GaussianBlur(im, (3, 3), 0.65)
        kps, des = sift_tilt.detectAndCompute(im, None)
        rdes = _rootsift(des)
        if rdes is not None and kps:
            pts = np.float32([k.pt for k in kps]) * np.float32([w / sw, h / sh])
            pts_all.append(pts)
            des_all.append(rdes)

    # 3. Diagonal (±45°) foreshortened views for diagonal 3D perspective tilt
    base_sz = 220
    im_base = cv2.resize(gray_ref, (base_sz, base_sz), interpolation=cv2.INTER_AREA)
    cx, cy = base_sz / 2.0, base_sz / 2.0
    for angle in (45.0, -45.0):
        M_rot = cv2.getRotationMatrix2D((cx, cy), angle, 1.0)
        # Squeeze Y axis by 0.60 around center to simulate 53° diagonal tilt
        S_mat = np.float32([[1.0, 0.0, 0.0], [0.0, 0.60, cy * 0.40]])
        M_aff = S_mat @ np.vstack([M_rot, [0.0, 0.0, 1.0]])
        tilted = cv2.warpAffine(
            im_base, M_aff, (base_sz, base_sz), flags=cv2.INTER_AREA, borderMode=cv2.BORDER_REPLICATE
        )
        tilted = cv2.GaussianBlur(tilted, (3, 3), 0.65)
        kps, des = sift_tilt.detectAndCompute(tilted, None)
        rdes = _rootsift(des)
        if rdes is not None and kps:
            M_inv = cv2.invertAffineTransform(M_aff)
            raw_pts = np.float32([k.pt for k in kps]).reshape(-1, 1, 2)
            unwarped = cv2.transform(raw_pts, M_inv).reshape(-1, 2)
            valid = (
                (unwarped[:, 0] >= 2)
                & (unwarped[:, 0] <= base_sz - 2)
                & (unwarped[:, 1] >= 2)
                & (unwarped[:, 1] <= base_sz - 2)
            )
            if np.any(valid):
                pts = unwarped[valid] * np.float32([w / base_sz, h / base_sz])
                pts_all.append(pts)
                des_all.append(rdes[valid])

    if not pts_all:
        return np.empty((0, 2), dtype=np.float32), np.empty((0, 128), dtype=np.float32)
    return np.vstack(pts_all), np.vstack(des_all)


def _compute_dual_descriptors(bgr: np.ndarray) -> tuple[np.ndarray, np.ndarray, dict[str, float]]:
    """
    Computes both:
    1. A 28x28 Global Layout descriptor (normalized LAB luminance + chrominance), and
    2. A 26x26 High-Pass Internal Detail descriptor (`lab - GaussianBlur(lab, 7x7)`),
       which removes broad radial gradients/lighting domes and isolates the sharp internal
       graphics (center bullseye, corner icons, grid lines, sculpted features).
    Also returns patch chroma/detail statistics to reject plain colored rectangles.
    """
    if bgr.shape[0] != 32 or bgr.shape[1] != 32:
        bgr = cv2.resize(bgr, (32, 32), interpolation=cv2.INTER_AREA)
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    blur_lab = cv2.GaussianBlur(lab, (7, 7), 1.5)
    hp = (lab - blur_lab)[3:29, 3:29, :]
    core = lab[2:30, 2:30, :]

    l_ch = core[:, :, 0]
    l_std = float(np.std(l_ch))
    a_ch = core[:, :, 1]
    b_ch = core[:, :, 2]
    a_c = a_ch - float(np.mean(a_ch))
    b_c = b_ch - float(np.mean(b_ch))
    chroma_std = float(np.sqrt(0.5 * (np.mean(a_c * a_c) + np.mean(b_c * b_c))))
    da = float(np.percentile(a_ch, 92) - np.percentile(a_ch, 8))
    db = float(np.percentile(b_ch, 92) - np.percentile(b_ch, 8))
    hp_std = float(np.std(hp))

    stats = {
        "l_std": l_std,
        "chroma_std": chroma_std,
        "da": da,
        "db": db,
        "hp_std": hp_std,
    }

    if l_std < 3.0:
        return (
            np.zeros(28 * 28 * 3, dtype=np.float32),
            np.zeros(26 * 26 * 3, dtype=np.float32),
            stats,
        )

    l_norm = (l_ch - float(np.mean(l_ch))) / l_std
    c_denom = max(chroma_std, 12.0)
    a_norm = a_c / c_denom
    b_norm = b_c / c_denom

    g_vec = np.concatenate(
        [
            (l_norm * 0.45).reshape(-1),
            (a_norm * 1.35).reshape(-1),
            (b_norm * 1.35).reshape(-1),
        ]
    ).astype(np.float32)
    g_norm = float(np.linalg.norm(g_vec))
    if g_norm > 1e-8:
        g_vec /= g_norm

    if hp_std < 2.2:
        hp_vec = np.zeros(26 * 26 * 3, dtype=np.float32)
    else:
        hp_vec = np.concatenate(
            [
                (hp[:, :, 0] * 0.70).reshape(-1),
                (hp[:, :, 1] * 1.15).reshape(-1),
                (hp[:, :, 2] * 1.15).reshape(-1),
            ]
        ).astype(np.float32)
        hp_norm = float(np.linalg.norm(hp_vec))
        if hp_norm > 1e-8:
            hp_vec /= hp_norm

    return g_vec, hp_vec, stats


def _detect_side_line_top(
    achrom: np.ndarray,
    gray: np.ndarray,
    sat: np.ndarray,
    pad: int = 20,
    is_chromatic: bool = True,
) -> tuple[float, float, float]:
    """
    Finds the top border line (a*x + b*y + c = 0) of the painting inside a rectified
    patch where the initial candidate quad sits at [pad .. S-pad].
    Automatically strips white card/paper margins and snaps directly onto the dark
    border line of the painting across the whole edge, ignoring corners occluded by fingers.
    """
    pts: list[tuple[float, float]] = []
    xs = list(range(28, 54, 2)) + list(range(74, 100, 2))
    for x in xs:
        col_a = achrom[:, x]
        col_g = gray[:, x]
        dark_outer = np.where(col_g[:pad] < 80)[0]
        start_y = 2
        if len(dark_outer) > 0:
            cand_start = int(dark_outer[-1]) + 1
            if np.any((col_a[cand_start : pad + 5] > 135) & (col_g[cand_start : pad + 5] > 170)):
                start_y = cand_start

        in_white = False
        white_end = -1
        for y in range(start_y, 48):
            if not in_white:
                if y <= pad + 4 and col_a[y] > 135 and col_g[y] > 170:
                    in_white = True
            else:
                if col_a[y] < 110:
                    white_end = y
                    break
        if white_end != -1:
            i0 = max(start_y, white_end - 1)
            i1 = min(len(col_g), white_end + 5)
            y_edge = float(i0 + int(np.argmin(col_g[i0:i1])))
            pts.append((float(x), y_edge))

    min_white_hits = 10 if is_chromatic else 17
    if len(pts) >= min_white_hits:
        arr = np.array(pts, dtype=np.float32)
        vx, vy, x0, y0 = cv2.fitLine(arr, cv2.DIST_L1, 0, 0.01, 0.01).flatten()
        return float(vy), float(-vx), float(vx * y0 - vy * x0)

    pts_fb: list[tuple[float, float]] = []
    for x in xs:
        col_g = gray[:, x]
        col_s = sat[:, x]
        sig = (col_s[pad - 6 : pad + 10] if is_chromatic else 0.0) + 0.5 * col_g[pad - 6 : pad + 10]
        grad = np.diff(sig) if is_chromatic else np.abs(np.diff(col_g[pad - 6 : pad + 10]))
        y_edge = float(pad - 6 + int(np.argmax(grad)) + 1)
        pts_fb.append((float(x), y_edge))
    arr = np.array(pts_fb, dtype=np.float32)
    vx, vy, x0, y0 = cv2.fitLine(arr, cv2.DIST_L1, 0, 0.01, 0.01).flatten()
    return float(vy), float(-vx), float(vx * y0 - vy * x0)


def _refine_painting_quad(
    bgr_img: np.ndarray, quad: np.ndarray, is_chromatic: bool = True
) -> np.ndarray:
    """
    Warps a candidate quad (with outer padding) into a canonical 128x128 patch,
    fits the 4 straight border lines of the painting (stripping any white card/paper
    margins and projecting cleanly past any thumb/finger corner occlusion), and
    intersects the 4 lines to recover the exact 4 painting corners.
    """
    pad = 20
    S = 128
    dst = np.float32([[pad, pad], [S - pad, pad], [S - pad, S - pad], [pad, S - pad]])
    M = cv2.getPerspectiveTransform(quad, dst)
    Minv = cv2.getPerspectiveTransform(dst, quad)
    patch = cv2.warpPerspective(bgr_img, M, (S, S))
    gray = cv2.cvtColor(patch, cv2.COLOR_BGR2GRAY).astype(np.float32)
    sat = cv2.cvtColor(patch, cv2.COLOR_BGR2HSV)[:, :, 1].astype(np.float32)
    achrom = np.clip(gray - 1.2 * sat, 0, 255)

    def get_side_line(k_rot: int) -> tuple[float, float, float]:
        r_a = np.rot90(achrom, k=k_rot)
        r_g = np.rot90(gray, k=k_rot)
        r_s = np.rot90(sat, k=k_rot)
        a, b, c = _detect_side_line_top(r_a, r_g, r_s, pad, is_chromatic)
        if abs(b) > abs(a):
            p1_r = (30.0, (-a * 30.0 - c) / b)
            p2_r = (98.0, (-a * 98.0 - c) / b)
        else:
            p1_r = ((-b * 30.0 - c) / a, 30.0)
            p2_r = ((-b * 98.0 - c) / a, 98.0)

        def unrot(pt: tuple[float, float]) -> tuple[float, float]:
            xu, yu = float(pt[0]), float(pt[1])
            for _ in range(k_rot):
                xu, yu = S - 1.0 - yu, xu
            return xu, yu

        x1, y1 = unrot(p1_r)
        x2, y2 = unrot(p2_r)
        return y2 - y1, x1 - x2, x2 * y1 - x1 * y2

    l_top = get_side_line(0)
    l_right = get_side_line(1)
    l_bot = get_side_line(2)
    l_left = get_side_line(3)

    def intersect(l1: tuple[float, float, float], l2: tuple[float, float, float]) -> list[float]:
        a1, b1, c1 = l1
        a2, b2, c2 = l2
        det = a1 * b2 - a2 * b1
        if abs(det) < 1e-7:
            return [0.0, 0.0]
        return [(b1 * c2 - b2 * c1) / det, (c1 * a2 - c2 * a1) / det]

    rect_c = np.float32(
        [
            intersect(l_top, l_left),
            intersect(l_top, l_right),
            intersect(l_bot, l_right),
            intersect(l_bot, l_left),
        ]
    )
    if not np.all((rect_c >= -8) & (rect_c <= S + 8)):
        return quad
    if cv2.contourArea(rect_c) < 0.15 * ((S - 2 * pad) ** 2):
        return quad
    refined = cv2.perspectiveTransform(rect_c.reshape(-1, 1, 2), Minv).reshape(4, 2)
    return _order_quad_corners(refined)


def _extract_candidate_quads(bgr: np.ndarray) -> list[np.ndarray]:
    """
    Extracts candidate convex 4-corner quadrilaterals at any angle (0°..360°),
    rejecting elongated non-painting rectangles or non-perspective shapes.
    """
    h, w = bgr.shape[:2]
    frame_area = float(w * h)
    min_side = 0.070 * min(w, h)

    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)

    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    sat = cv2.GaussianBlur(hsv[:, :, 1], (5, 5), 0)

    achrom = np.clip(blurred.astype(np.int16) - (1.2 * sat).astype(np.int16), 0, 255).astype(
        np.uint8
    )

    quads: list[tuple[float, np.ndarray]] = []

    def is_valid_quad_geometry(ordered: np.ndarray) -> bool:
        sides = [float(np.linalg.norm(ordered[(i + 1) % 4] - ordered[i])) for i in range(4)]
        if min(sides) < min_side or max(sides) / (min(sides) + 1e-5) > 2.2:
            return False
        # Opposite sides of a planar rectangle under perspective cannot diverge wildly
        if max(sides[0] / (sides[2] + 1e-5), sides[2] / (sides[0] + 1e-5)) > 1.85:
            return False
        if max(sides[1] / (sides[3] + 1e-5), sides[3] / (sides[1] + 1e-5)) > 1.85:
            return False
        return True

    def add_contour_quads(c: np.ndarray) -> None:
        hull = cv2.convexHull(c)
        area = cv2.contourArea(hull)
        if area < 0.015 * frame_area or area > 0.90 * frame_area:
            return

        peri = cv2.arcLength(hull, True)
        added_poly = False
        for eps in (0.018, 0.028, 0.042, 0.056):
            approx = cv2.approxPolyDP(hull, eps * peri, True)
            if len(approx) == 4 and cv2.isContourConvex(approx):
                q_area = cv2.contourArea(approx)
                if q_area / (area + 1e-5) < 0.86:
                    continue
                ordered = _order_quad_corners(approx.reshape(4, 2).astype(np.float32))
                if is_valid_quad_geometry(ordered):
                    quads.append((q_area / (area + 1e-5), ordered))
                    added_poly = True
                break

        if not added_poly:
            rect = cv2.minAreaRect(hull)
            rw, rh = rect[1]
            rect_area = rw * rh
            if rect_area > 0 and area / rect_area >= 0.80 and min(rw, rh) >= min_side:
                box = cv2.boxPoints(rect).astype(np.float32)
                if (
                    np.all(box[:, 0] >= -0.05 * w)
                    and np.all(box[:, 0] <= 1.05 * w)
                    and np.all(box[:, 1] >= -0.05 * h)
                    and np.all(box[:, 1] <= 1.05 * h)
                ):
                    ordered = _order_quad_corners(box)
                    if is_valid_quad_geometry(ordered):
                        quads.append((area / rect_area, ordered))

    for channel in (blurred, sat):
        for thresh_val in (55, 85, 115, 145, 175):
            _, bw = cv2.threshold(channel, thresh_val, 255, cv2.THRESH_BINARY)
            cnts, _ = cv2.findContours(bw, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
            for c in cnts:
                add_contour_quads(c)

    for thresh_val in (95, 135):
        _, bw = cv2.threshold(achrom, thresh_val, 255, cv2.THRESH_BINARY)
        cnts, _ = cv2.findContours(bw, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        for c in cnts:
            add_contour_quads(c)
        _, bwi = cv2.threshold(achrom, thresh_val, 255, cv2.THRESH_BINARY_INV)
        cnts_i, _ = cv2.findContours(bwi, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        for c in cnts_i:
            add_contour_quads(c)

    edges = cv2.Canny(blurred, 40, 130)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)
    cnts, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    for c in cnts:
        add_contour_quads(c)

    unique: list[np.ndarray] = []
    for _, q in sorted(quads, key=lambda x: x[0], reverse=True):
        if not any(float(np.max(np.abs(q - u))) < 7.0 for u in unique):
            unique.append(q)
    return unique


class PaintingDetector:
    """
    Fast, 0°..360° rotation- and tilt-invariant painting detector.
    Combines Dual-Template (Global + High-Pass Internal Detail) quad verification
    with Multi-Scale Affine-RootSIFT (ASIFT) + USAC_MAGSAC homography estimation.
    """

    def __init__(self) -> None:
        self.sift_frame = cv2.SIFT_create(nfeatures=650, contrastThreshold=0.026, edgeThreshold=12)
        self.refs: list[dict[str, Any]] = []

    def load(self) -> None:
        self.refs = []
        catalog = settings.data_dir / "paintings.json"
        with open(catalog, "r", encoding="utf-8") as f:
            items = json.load(f)

        for item in items:
            path = settings.data_dir / "paintings" / item["image"]
            bgr = cv2.imread(str(path), cv2.IMREAD_COLOR)
            if bgr is None:
                logger.warning("Reference image missing: %s", path)
                continue
            bgr, _ = _resize_long_side(bgr, 480)
            gray = cv2.cvtColor(bgr, cv2.IMREAD_GRAYSCALE)

            pts_asift, des_asift = _build_asift_bank(gray)

            lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
            chroma_std = float(np.hypot(np.std(lab[:, :, 1]), np.std(lab[:, :, 2])))
            is_chromatic = chroma_std >= 8.0

            g_templates = []
            hp_templates = []
            for rot_k in range(4):
                r_img = np.rot90(bgr, k=rot_k)
                for variant in (r_img, cv2.flip(r_img, 1)):
                    gv, hv, _ = _compute_dual_descriptors(variant)
                    g_templates.append(gv)
                    hp_templates.append(hv)

            h, w = bgr.shape[:2]
            self.refs.append(
                {
                    "id": item["id"],
                    "title": item["title"],
                    "artist": item["artist"],
                    "width": w,
                    "height": h,
                    "is_chromatic": is_chromatic,
                    "points": pts_asift,
                    "descriptors": des_asift,
                    "g_templates": np.vstack(g_templates),
                    "hp_templates": np.vstack(hp_templates),
                }
            )
            logger.info(
                "Indexed %s (%dx%d, chromatic=%s, asift_kps=%d)",
                item["id"],
                w,
                h,
                is_chromatic,
                len(pts_asift),
            )

    def _score_quad(
        self, bgr: np.ndarray, quad: np.ndarray, require_hp: bool = True
    ) -> tuple[dict[str, Any] | None, float]:
        dst_canon = np.float32([[0, 0], [32, 0], [32, 32], [0, 32]])
        M = cv2.getPerspectiveTransform(quad, dst_canon)
        patch = cv2.warpPerspective(bgr, M, (32, 32))
        g_vec, hp_vec, stats = _compute_dual_descriptors(patch)

        # Reject patches without internal detail/graphics (e.g. plain yellow/colored rectangles)
        if stats["l_std"] < 4.0 or stats["hp_std"] < 4.2:
            return None, 0.0

        best_ref = None
        best_score = 0.0
        for ref in self.refs:
            if ref["is_chromatic"]:
                # Chromatic paintings (Equinox I & II) have both strong red-green (da) and
                # yellow-blue (db) multi-hue opposition; single-hue yellow/orange objects fail this.
                if stats["chroma_std"] < 7.5 or stats["da"] < 15.0 or stats["db"] < 15.0:
                    continue
            else:
                # Monochrome paintings (Monolith I & II) cannot have strong multi-hue saturation
                if stats["chroma_std"] > 20.0:
                    continue

            g_sims = np.dot(ref["g_templates"], g_vec)
            hp_sims = np.dot(ref["hp_templates"], hp_vec)

            for k in range(8):
                gs = float(g_sims[k])
                hs = float(hp_sims[k])
                if require_hp:
                    # Both global layout AND high-pass internal graphics must match at orientation k
                    if gs >= 0.46 and hs >= 0.24:
                        combined = 0.72 * gs + 0.28 * max(0.0, hs)
                        if combined > best_score:
                            best_score = combined
                            best_ref = ref
                else:
                    # Pre-refinement candidate ranking (before white card margins are stripped)
                    if gs >= 0.42:
                        combined = 0.85 * gs + 0.15 * max(0.0, hs)
                        if combined > best_score:
                            best_score = combined
                            best_ref = ref

        return best_ref, best_score

    def _match_quads(self, bgr: np.ndarray):
        quads = _extract_candidate_quads(bgr)
        if not quads:
            return None

        scored: list[tuple[float, dict[str, Any], np.ndarray]] = []
        for quad in quads:
            ref, score = self._score_quad(bgr, quad, require_hp=False)
            if ref is not None and score >= 0.38:
                scored.append((score, ref, quad))

        if not scored:
            return None

        scored.sort(key=lambda x: x[0], reverse=True)

        best_score = 0.0
        best_ref = None
        best_quad = None

        for _, ref, quad in scored[:4]:
            refined_quad = _refine_painting_quad(bgr, quad, is_chromatic=ref["is_chromatic"])
            ref_after, score_after = self._score_quad(bgr, refined_quad, require_hp=True)
            if ref_after is not None and score_after > best_score:
                best_score = score_after
                best_ref = ref_after
                best_quad = refined_quad
            else:
                # Also check if the unrefined quad itself passes the strict require_hp=True check
                ref_raw, score_raw = self._score_quad(bgr, quad, require_hp=True)
                if ref_raw is not None and score_raw > best_score:
                    best_score = score_raw
                    best_ref = ref_raw
                    best_quad = refined_quad

        if best_ref is not None and best_quad is not None and best_score >= 0.46:
            return best_ref, int(round(best_score * 50)), best_score, best_quad
        return None

    def _match_sift(
        self, ref: dict[str, Any], frame_pts: np.ndarray, frame_des_r: np.ndarray, fw: int, fh: int
    ):
        ref_des = ref["descriptors"]
        ref_pts = ref["points"]
        if ref_des is None or len(ref_pts) < 12 or len(frame_pts) < 8:
            return None

        # Fast vectorized BLAS cosine similarity -> L2 distance for RootSIFT unit vectors
        sims = ref_des @ frame_des_r.T
        idx_part = np.argpartition(sims, -2, axis=1)[:, -2:]
        s_top2 = np.take_along_axis(sims, idx_part, axis=1)
        d_top2 = np.sqrt(np.maximum(0.0, 2.0 - 2.0 * s_top2))

        swap = d_top2[:, 0] > d_top2[:, 1]
        d1 = np.where(swap, d_top2[:, 1], d_top2[:, 0])
        d2 = np.where(swap, d_top2[:, 0], d_top2[:, 1])
        best_f = np.where(swap, idx_part[:, 1], idx_part[:, 0])

        good_mask = d1 < 0.79 * d2
        if int(np.sum(good_mask)) < 8:
            return None

        src = ref_pts[good_mask].reshape(-1, 1, 2)
        dst = frame_pts[best_f[good_mask]].reshape(-1, 1, 2)

        method = getattr(cv2, "USAC_MAGSAC", cv2.RANSAC)
        homography, mask = cv2.findHomography(src, dst, method, 5.0)
        if homography is None or mask is None:
            return None

        inlier_mask = mask.ravel().astype(bool)
        # Count spatially distinct frame keypoints among inliers (since multi-scale bank
        # can have 2 scales matching the same frame keypoint)
        unique_frame_inliers = len(np.unique(best_f[good_mask][inlier_mask]))
        if unique_frame_inliers < 8:
            return None

        w, h = ref["width"], ref["height"]
        ref_corners = np.float32([[0, 0], [w, 0], [w, h], [0, h]]).reshape(-1, 1, 2)
        corners = cv2.perspectiveTransform(ref_corners, homography).reshape(4, 2)

        area = cv2.contourArea(corners)
        frame_area = fw * fh
        if not cv2.isContourConvex(corners.reshape(-1, 1, 2)):
            return None
        if area < 0.008 * frame_area or area > 4.0 * frame_area:
            return None

        ordered = _order_quad_corners(corners)
        sides = [float(np.linalg.norm(ordered[(i + 1) % 4] - ordered[i])) for i in range(4)]
        if min(sides) < 0.05 * min(fw, fh) or max(sides) / (min(sides) + 1e-5) > 2.6:
            return None
        if max(sides[0] / (sides[2] + 1e-5), sides[2] / (sides[0] + 1e-5)) > 2.1:
            return None
        if max(sides[1] / (sides[3] + 1e-5), sides[3] / (sides[1] + 1e-5)) > 2.1:
            return None

        return unique_frame_inliers, ordered

    def detect(self, image_bytes: bytes) -> dict[str, Any]:
        miss = {
            "match": False,
            "painting_id": None,
            "title": None,
            "artist": None,
            "corners": None,
            "inliers": 0,
        }

        bgr_raw = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_COLOR)
        if bgr_raw is None:
            return miss

        # 1. Fast quad + dual-template path on 360px frame
        bgr_360, _ = _resize_long_side(bgr_raw, 360)
        fh360, fw360 = bgr_360.shape[:2]
        quad_hit = self._match_quads(bgr_360)

        if quad_hit is not None and quad_hit[2] >= 0.52:
            ref, inliers, score, corners = quad_hit
            return {
                "match": True,
                "painting_id": ref["id"],
                "title": ref["title"],
                "artist": ref["artist"],
                "corners": [
                    [round(float(x) / fw360, 4), round(float(y) / fh360, 4)] for x, y in corners
                ],
                "inliers": inliers,
            }

        # 2. Multi-Scale ASIFT + RootSIFT + USAC_MAGSAC homography path (288px -> 576px Octave -1)
        bgr_sift, _ = _resize_long_side(bgr_raw, 288)
        fhs, fws = bgr_sift.shape[:2]
        gray_sift = cv2.cvtColor(bgr_sift, cv2.COLOR_BGR2GRAY)
        kps, des = self.sift_frame.detectAndCompute(gray_sift, None)
        des_r = _rootsift(des)
        if des_r is not None and kps and len(kps) >= 8:
            frame_pts = np.float32([kp.pt for kp in kps])
            best = None
            for ref in self.refs:
                result = self._match_sift(ref, frame_pts, des_r, fws, fhs)
                if result and (best is None or result[0] > best[1][0]):
                    best = (ref, result)

            if best is not None and best[1][0] >= 9:
                ref, (inliers, corners) = best
                return {
                    "match": True,
                    "painting_id": ref["id"],
                    "title": ref["title"],
                    "artist": ref["artist"],
                    "corners": [
                        [round(float(x) / fws, 4), round(float(y) / fhs, 4)] for x, y in corners
                    ],
                    "inliers": inliers,
                }

        if quad_hit is not None:
            ref, inliers, score, corners = quad_hit
            return {
                "match": True,
                "painting_id": ref["id"],
                "title": ref["title"],
                "artist": ref["artist"],
                "corners": [
                    [round(float(x) / fw360, 4), round(float(y) / fh360, 4)] for x, y in corners
                ],
                "inliers": inliers,
            }

        return miss


detector = PaintingDetector()
