import * as THREE from 'three';
import type { Point, Pose6DoF } from '../types';

export interface ProjectedCanvasPose {
	id: string;
	position: THREE.Vector3;
	screenPosition: THREE.Vector3;
	quaternion: THREE.Quaternion;
	scale: number;
	avgWidthPx: number;
	avgHeightPx: number;
	spanPx: number;
	depthCanvasUnits: number;
	vFovDeg: number;
	aspectRatio: number;
}

/**
 * Projects a detected 4-corner quad from normalized video coordinates into the Three.js camera frame
 * where 1.0 unit equals 1.0 canvas width, +X is canvas right, +Y is canvas up, and +Z points toward the viewer.
 */
export function computeCanvasPoseFromCorners(
	id: string,
	ptsRaw: Point[],
	videoWidth: number,
	videoHeight: number,
	viewWidth: number,
	viewHeight: number,
	pose?: Pose6DoF | null,
	vFovDeg = 50
): ProjectedCanvasPose | null {
	if (ptsRaw.length !== 4 || !videoWidth || !videoHeight || !viewWidth || !viewHeight) {
		return null;
	}

	const coverScale = Math.max(viewWidth / videoWidth, viewHeight / videoHeight);
	const offsetX = (videoWidth * coverScale - viewWidth) / 2;
	const offsetY = (videoHeight * coverScale - viewHeight) / 2;

	const pts = ptsRaw.map((p) => ({
		x: p.x * videoWidth * coverScale - offsetX,
		y: p.y * videoHeight * coverScale - offsetY
	}));

	const [p0, p1, p2, p3] = pts;
	const cx = (p0.x + p1.x + p2.x + p3.x) / 4;
	const cy = (p0.y + p1.y + p2.y + p3.y) / 4;

	const topW = Math.hypot(p1.x - p0.x, p1.y - p0.y);
	const botW = Math.hypot(p2.x - p3.x, p2.y - p3.y);
	const leftH = Math.hypot(p3.x - p0.x, p3.y - p0.y);
	const rightH = Math.hypot(p2.x - p1.x, p2.y - p1.y);

	const avgW = (topW + botW) / 2;
	const avgH = (leftH + rightH) / 2;
	const span = Math.max(avgW, avgH);

	if (span < 20) {
		return null;
	}

	const vFovRad = (vFovDeg * Math.PI) / 180;
	const fy = viewHeight / 2 / Math.tan(vFovRad / 2);
	const fx = fy;

	const Z = Math.max(0.35, Math.min(18.0, (fy * 1.0) / span));
	const X = ((cx - viewWidth / 2) * Z) / fx;
	const Y = -((cy - viewHeight / 2) * Z) / fy;
	const scale = (Z * span) / fy;

	const quaternion = new THREE.Quaternion();
	if (pose && Array.isArray(pose.quaternion) && pose.quaternion.length === 4) {
		const [qx, qy, qz, qw] = pose.quaternion;
		quaternion.set(qx, qy, qz, qw).normalize();
	} else {
		const roll = Math.atan2(p1.y - p0.y, p1.x - p0.x);
		const pitch = Math.atan2(botW - topW, span) * 1.5;
		const yaw = Math.atan2(rightH - leftH, span) * 1.5;
		quaternion.setFromEuler(new THREE.Euler(pitch, yaw, -roll, 'YXZ'));
	}

	const screenPosition = new THREE.Vector3(X, Y, -Z);
	const position =
		pose && Array.isArray(pose.position) && pose.position.length === 3
			? new THREE.Vector3(pose.position[0], pose.position[1], pose.position[2])
			: screenPosition.clone();

	return {
		id,
		position,
		screenPosition,
		quaternion,
		scale,
		avgWidthPx: avgW,
		avgHeightPx: avgH,
		spanPx: span,
		depthCanvasUnits: Z,
		vFovDeg,
		aspectRatio: avgH > 0 ? avgW / avgH : 1
	};
}
