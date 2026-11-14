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


def _chrominance_descriptor(bgr: np.ndarray) -> np.ndarray:
    """
    Computes a fast, glare-invariant 28x28 LAB chrominance + luminance descriptor.
    Normalizes each channel to zero-mean unit-variance so screen glare, exposure,
    and ambient lighting color casts cancel out.
    """
    if bgr.shape[0] != 32 or bgr.shape[1] != 32:
        bgr = cv2.resize(bgr, (32, 32), interpolation=cv2.INTER_AREA)
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    core = lab[2:30, 2:30, :].copy()
    for c in range(3):
        ch = core[:, :, c]
        std = float(np.std(ch))
        if std < 2.0:
            return np.zeros(28 * 28 * 3, dtype=np.float32)
        core[:, :, c] = (ch - float(np.mean(ch))) / std

    core[:, :, 0] *= 0.45
    core[:, :, 1] *= 1.25
    core[:, :, 2] *= 1.25
    vec = core.reshape(-1)
    norm = float(np.linalg.norm(vec))
    return vec / norm if norm > 1e-8 else vec


def _detect_side_line_top(
    achrom: np.ndarray, gray: np.ndarray, sat: np.ndarray, pad: int = 20
) -> tuple[float, float, float]:
    """
    Finds the top border line (a*x + b*y + c = 0) of the painting inside a rectified
    patch where the initial candidate quad sits at [pad .. S-pad].
    Automatically strips white card/paper margins (high achromatic brightness) and snaps
    directly onto the dark border line of the painting across the whole edge, ignoring
    corners occluded by fingers/thumbs.
    """
    pts: list[tuple[float, float]] = []
    # Sample across both halves of the edge, skipping the very midpoint [54..74] where
    # the semicircular edge marker sits.
    xs = list(range(28, 54, 2)) + list(range(74, 100, 2))
    for x in xs:
        col_a = achrom[:, x]
        col_g = gray[:, x]
        # Skip outer dark background (e.g. phone bezel or dark webpage header) if a white
        # card margin follows it near `pad`.
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

    if len(pts) >= 10:
        arr = np.array(pts, dtype=np.float32)
        vx, vy, x0, y0 = cv2.fitLine(arr, cv2.DIST_L1, 0, 0.01, 0.01).flatten()
        return float(vy), float(-vx), float(vx * y0 - vy * x0)

    # Fallback when there is no white card margin on this side: snap to the sharpest
    # inward step into the painting near `pad`.
    pts_fb: list[tuple[float, float]] = []
    for x in xs:
        col_g = gray[:, x]
        col_s = sat[:, x]
        sig = col_s[pad - 6 : pad + 10] + 0.5 * col_g[pad - 6 : pad + 10]
        grad = np.diff(sig)
        y_edge = float(pad - 6 + int(np.argmax(grad)) + 1)
        pts_fb.append((float(x), y_edge))
    arr = np.array(pts_fb, dtype=np.float32)
    vx, vy, x0, y0 = cv2.fitLine(arr, cv2.DIST_L1, 0, 0.01, 0.01).flatten()
    return float(vy), float(-vx), float(vx * y0 - vy * x0)


def _refine_painting_quad(bgr_img: np.ndarray, quad: np.ndarray) -> np.ndarray:
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
        a, b, c = _detect_side_line_top(r_a, r_g, r_s, pad)
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
    Extracts candidate convex 4-corner quadrilaterals at any angle (0°..360°)
    and aspect ratio using convex-hull polygon approximation and rotated bounding boxes.
    """
    h, w = bgr.shape[:2]
    frame_area = float(w * h)
    min_side = 0.075 * min(w, h)

    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)

    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    sat = cv2.GaussianBlur(hsv[:, :, 1], (5, 5), 0)

    # Achromatic light channel highlights white cards/paper margins vs colorful/dark paintings
    achrom = np.clip(blurred.astype(np.int16) - (1.2 * sat).astype(np.int16), 0, 255).astype(
        np.uint8
    )

    quads: list[tuple[float, np.ndarray]] = []

    def add_contour_quads(c: np.ndarray) -> None:
        hull = cv2.convexHull(c)
        area = cv2.contourArea(hull)
        if area < 0.018 * frame_area or area > 0.90 * frame_area:
            return

        peri = cv2.arcLength(hull, True)
        added_poly = False
        for eps in (0.018, 0.028, 0.042, 0.058):
            approx = cv2.approxPolyDP(hull, eps * peri, True)
            if len(approx) == 4 and cv2.isContourConvex(approx):
                q_area = cv2.contourArea(approx)
                if q_area / (area + 1e-5) < 0.86:
                    continue
                ordered = _order_quad_corners(approx.reshape(4, 2).astype(np.float32))
                sides = [float(np.linalg.norm(ordered[(i + 1) % 4] - ordered[i])) for i in range(4)]
                if min(sides) >= min_side and max(sides) / (min(sides) + 1e-5) <= 4.5:
                    # Rank by how closely the 4-gon fits the hull (sharpest true quads first)
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
                    quads.append((area / rect_area, _order_quad_corners(box)))

    # 1. Multi-threshold segmentation on luminance and saturation
    for channel in (blurred, sat):
        for thresh_val in (55, 85, 115, 145, 175):
            _, bw = cv2.threshold(channel, thresh_val, 255, cv2.THRESH_BINARY)
            cnts, _ = cv2.findContours(bw, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
            for c in cnts:
                add_contour_quads(c)

    # 2. Achromatic light thresholds (captures both white cards and dark holes inside them)
    for thresh_val in (95, 135):
        _, bw = cv2.threshold(achrom, thresh_val, 255, cv2.THRESH_BINARY)
        cnts, _ = cv2.findContours(bw, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        for c in cnts:
            add_contour_quads(c)
        _, bwi = cv2.threshold(achrom, thresh_val, 255, cv2.THRESH_BINARY_INV)
        cnts_i, _ = cv2.findContours(bwi, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        for c in cnts_i:
            add_contour_quads(c)

    # 3. Canny edge contours
    edges = cv2.Canny(blurred, 40, 130)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)
    cnts, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    for c in cnts:
        add_contour_quads(c)

    # Deduplicate only nearly-identical quads (within 7px), keeping highest quad-fit quality first
    unique: list[np.ndarray] = []
    for _, q in sorted(quads, key=lambda x: x[0], reverse=True):
        if not any(float(np.max(np.abs(q - u))) < 7.0 for u in unique):
            unique.append(q)
    return unique


class PaintingDetector:
    """
    Fast, rotation-invariant (0°..360°) painting detector.
    Finds any demo painting in the camera frame and returns its exact 4 corners.
    """

    def __init__(self) -> None:
        self.sift = cv2.SIFT_create(nfeatures=650)
        self.matcher = cv2.BFMatcher(cv2.NORM_L2)
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
            bgr, _ = _resize_long_side(bgr, 512)
            gray = cv2.cvtColor(bgr, cv2.IMREAD_GRAYSCALE)
            kps, des = self.sift.detectAndCompute(gray, None)

            templates = []
            for rot_k in range(4):
                r_img = np.rot90(bgr, k=rot_k)
                templates.append(_chrominance_descriptor(r_img))
                templates.append(_chrominance_descriptor(cv2.flip(r_img, 1)))

            h, w = bgr.shape[:2]
            self.refs.append(
                {
                    "id": item["id"],
                    "title": item["title"],
                    "artist": item["artist"],
                    "width": w,
                    "height": h,
                    "points": np.float32([kp.pt for kp in kps])
                    if kps
                    else np.empty((0, 2), dtype=np.float32),
                    "descriptors": des,
                    "templates": np.vstack(templates),
                }
            )
            logger.info("Indexed %s (%dx%d)", item["id"], w, h)

    def _score_quad(self, bgr: np.ndarray, quad: np.ndarray) -> tuple[dict[str, Any] | None, float]:
        dst_canon = np.float32([[0, 0], [32, 0], [32, 32], [0, 32]])
        M = cv2.getPerspectiveTransform(quad, dst_canon)
        patch = cv2.warpPerspective(bgr, M, (32, 32))
        p_vec = _chrominance_descriptor(patch)
        if float(np.linalg.norm(p_vec)) < 0.5:
            return None, 0.0

        best_ref = None
        best_score = 0.0
        for ref in self.refs:
            sims = np.dot(ref["templates"], p_vec)
            score = float(np.max(sims))
            if score > best_score:
                best_score = score
                best_ref = ref
        return best_ref, best_score

    def _match_quads(self, bgr: np.ndarray):
        quads = _extract_candidate_quads(bgr)
        if not quads:
            return None

        scored: list[tuple[float, dict[str, Any], np.ndarray]] = []
        for quad in quads:
            ref, score = self._score_quad(bgr, quad)
            if ref is not None and score >= 0.40:
                scored.append((score, ref, quad))

        if not scored:
            return None

        scored.sort(key=lambda x: x[0], reverse=True)

        # Refine the top candidates (up to 3) so white card margins and thumb occlusions
        # are stripped before selecting the winning quad.
        best_score = 0.0
        best_ref = None
        best_quad = None

        for raw_score, ref, quad in scored[:3]:
            refined_quad = _refine_painting_quad(bgr, quad)
            ref_after, score_after = self._score_quad(bgr, refined_quad)
            # Use the refined quad and the better of its pre/post score
            eff_score = max(raw_score, score_after)
            eff_ref = ref_after if (ref_after is not None and score_after >= raw_score) else ref
            if eff_score > best_score:
                best_score = eff_score
                best_ref = eff_ref
                best_quad = refined_quad

        if best_ref is not None and best_quad is not None and best_score >= 0.46:
            return best_ref, int(round(best_score * 45)), best_score, best_quad
        return None

    def _match_sift(
        self, ref: dict[str, Any], frame_pts: np.ndarray, frame_des: np.ndarray, fw: int, fh: int
    ):
        if ref["descriptors"] is None or len(ref["points"]) < 8:
            return None
        pairs = self.matcher.knnMatch(ref["descriptors"], frame_des, k=2)
        good = [
            m
            for m, n in (p for p in pairs if len(p) == 2)
            if m.distance < settings.ratio_test * n.distance
        ]
        if len(good) < 8:
            return None

        src = ref["points"][[m.queryIdx for m in good]].reshape(-1, 1, 2)
        dst = frame_pts[[m.trainIdx for m in good]].reshape(-1, 1, 2)
        homography, mask = cv2.findHomography(src, dst, cv2.RANSAC, 5.0)
        if homography is None or mask is None:
            return None
        inliers = int(mask.sum())

        w, h = ref["width"], ref["height"]
        ref_corners = np.float32([[0, 0], [w, 0], [w, h], [0, h]]).reshape(-1, 1, 2)
        corners = cv2.perspectiveTransform(ref_corners, homography).reshape(4, 2)

        area = cv2.contourArea(corners)
        frame_area = fw * fh
        if not cv2.isContourConvex(corners.reshape(-1, 1, 2)):
            return None
        if area < 0.01 * frame_area or area > 6 * frame_area:
            return None

        return inliers, _order_quad_corners(corners)

    def detect(self, image_bytes: bytes) -> dict[str, Any]:
        miss = {
            "match": False,
            "painting_id": None,
            "title": None,
            "artist": None,
            "corners": None,
            "inliers": 0,
        }

        bgr = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_COLOR)
        if bgr is None:
            return miss
        bgr, _ = _resize_long_side(bgr, 360)
        fh, fw = bgr.shape[:2]

        quad_hit = self._match_quads(bgr)
        if quad_hit is not None:
            ref, inliers, score, corners = quad_hit
            return {
                "match": True,
                "painting_id": ref["id"],
                "title": ref["title"],
                "artist": ref["artist"],
                "corners": [[round(float(x) / fw, 4), round(float(y) / fh, 4)] for x, y in corners],
                "inliers": inliers,
            }

        gray = cv2.cvtColor(bgr, cv2.IMREAD_GRAYSCALE)
        kps, des = self.sift.detectAndCompute(gray, None)
        if des is None or len(kps) < 8:
            return miss
        frame_pts = np.float32([kp.pt for kp in kps])

        best = None
        for ref in self.refs:
            result = self._match_sift(ref, frame_pts, des, fw, fh)
            if result and (best is None or result[0] > best[1][0]):
                best = (ref, result)

        if best is None:
            return miss

        ref, (inliers, corners) = best
        if inliers < settings.min_inliers:
            return {**miss, "inliers": inliers}

        return {
            "match": True,
            "painting_id": ref["id"],
            "title": ref["title"],
            "artist": ref["artist"],
            "corners": [[round(float(x) / fw, 4), round(float(y) / fh, 4)] for x, y in corners],
            "inliers": inliers,
        }


detector = PaintingDetector()
