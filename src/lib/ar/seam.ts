import type {
	EdgeLetter,
	EdgeMap,
	PaintingInfo,
	PairInfo,
	RotationDeg,
	SeamEvaluation,
	TrackedCanvas
} from '#lib/types';

/**
 * Standard edge assignment at 0° rotation per domain rules:
 * top = A, right = B, left = C, bottom = D
 */
export const DEFAULT_BASE_EDGES: EdgeMap = {
	top: 'A',
	right: 'B',
	left: 'C',
	bottom: 'D'
};

export const ROTATION_STEPS: RotationDeg[] = [0, 90, 180, 270];

/**
 * Computes which edge letter sits at top/right/bottom/left when a square canvas
 * is rotated clockwise in 90° steps.
 */
export function rotateEdges(base: EdgeMap, rotation: RotationDeg): EdgeMap {
	switch (rotation) {
		case 0:
			return {
				top: base.top,
				right: base.right,
				bottom: base.bottom,
				left: base.left
			};
		case 90:
			return {
				top: base.left,
				right: base.top,
				bottom: base.right,
				left: base.bottom
			};
		case 180:
			return {
				top: base.bottom,
				right: base.left,
				bottom: base.top,
				left: base.right
			};
		case 270:
			return {
				top: base.right,
				right: base.bottom,
				bottom: base.left,
				left: base.top
			};
	}
}

/**
 * Returns the edge map for a painting at a given 90° rotation,
 * using explicit DB overrides if present, or rotating baseEdges.
 */
export function getPaintingEdges(painting: PaintingInfo, rotation: RotationDeg): EdgeMap {
	if (painting.orientationEdges && painting.orientationEdges[rotation]) {
		return painting.orientationEdges[rotation]!;
	}
	return rotateEdges(painting.baseEdges, rotation);
}

/**
 * Snaps an arbitrary angle in degrees to the nearest 90° step (0 | 90 | 180 | 270).
 */
export function snapRotationDeg(angleDeg: number): RotationDeg {
	const normalized = ((angleDeg % 360) + 360) % 360;
	const index = Math.round(normalized / 90) % 4;
	return ROTATION_STEPS[index];
}

/**
 * Evaluates the seam between two tracked square canvases displayed side by side.
 * Of the 16 possible orientation combinations, only AA, BB, CC, DD are valid.
 */
export function evaluateSeam(
	pair: PairInfo,
	canvasA: TrackedCanvas | null,
	canvasB: TrackedCanvas | null
): SeamEvaluation {
	if (!canvasA || !canvasB) {
		return {
			bothTracked: false,
			leftCanvas: canvasA ?? canvasB,
			rightCanvas: null,
			leftFacingEdge: null,
			rightFacingEdge: null,
			seamCode: null,
			isValidMatch: false,
			matchedLetter: null,
			activeExperience: null
		};
	}

	// Determine horizontal side-by-side ordering in camera/world X space
	const isALeft = canvasA.pose.x <= canvasB.pose.x;
	const leftCanvas = isALeft ? canvasA : canvasB;
	const rightCanvas = isALeft ? canvasB : canvasA;

	// The seam is between the right edge of the left canvas and the left edge of the right canvas
	const leftFacingEdge: EdgeLetter = leftCanvas.edges.right;
	const rightFacingEdge: EdgeLetter = rightCanvas.edges.left;
	const seamCode = `${leftFacingEdge}${rightFacingEdge}`;
	const isValidMatch = leftFacingEdge === rightFacingEdge;
	const matchedLetter: EdgeLetter | null = isValidMatch ? leftFacingEdge : null;

	const candidateExp = matchedLetter ? (pair.experiences[matchedLetter] ?? null) : null;
	const activeExperience =
		candidateExp && candidateExp.isActive && candidateExp.status === 'ready' ? candidateExp : null;

	return {
		bothTracked: true,
		leftCanvas,
		rightCanvas,
		leftFacingEdge,
		rightFacingEdge,
		seamCode,
		isValidMatch,
		matchedLetter,
		activeExperience
	};
}

export interface ArrangementCombination {
	rotationA: RotationDeg;
	rotationB: RotationDeg;
	edgeA: EdgeLetter;
	edgeB: EdgeLetter;
	seamCode: string;
	isValid: boolean;
	matchedLetter: EdgeLetter | null;
}

/**
 * Enumerates all 16 orientation combinations (4x4) for a pair when Painting A is left and Painting B is right.
 * Exactly 4 are valid (AA, BB, CC, DD) and 12 are non-matching.
 */
export function getAll16Arrangements(pair: PairInfo): ArrangementCombination[] {
	const results: ArrangementCombination[] = [];
	for (const rotationA of ROTATION_STEPS) {
		for (const rotationB of ROTATION_STEPS) {
			const edgesA = getPaintingEdges(pair.paintingA, rotationA);
			const edgesB = getPaintingEdges(pair.paintingB, rotationB);
			const edgeA = edgesA.right;
			const edgeB = edgesB.left;
			const isValid = edgeA === edgeB;
			results.push({
				rotationA,
				rotationB,
				edgeA,
				edgeB,
				seamCode: `${edgeA}${edgeB}`,
				isValid,
				matchedLetter: isValid ? edgeA : null
			});
		}
	}
	return results;
}

/**
 * Phase 1 hardcoded pair: two square canvases by partner artist Mircea Popescu,
 * with the 4 valid seam arrangements (AA, BB, CC, DD) configured for shader_blend.
 */
export const PHASE1_DEMO_PAIR: PairInfo = {
	id: 'pair-01-equinox',
	published: true,
	paintingA: {
		id: 'painting-a-solar',
		artistId: 'artist-mircea-popescu',
		artistName: 'Mircea Popescu',
		title: 'Equinox I — Solar Ember',
		year: 2026,
		medium: 'Acrylic & gold leaf on square linen canvas',
		description: 'Left modular diptych canvas exploring warm solar currents across four rotational axes.',
		widthCm: 60,
		heightCm: 60,
		imageUrl: '/demo-targets/painting-a.svg',
		trackabilityScore: 92,
		baseEdges: { ...DEFAULT_BASE_EDGES }
	},
	paintingB: {
		id: 'painting-b-lunar',
		artistId: 'artist-mircea-popescu',
		artistName: 'Mircea Popescu',
		title: 'Equinox II — Astral Tide',
		year: 2026,
		medium: 'Acrylic & Prussian pigment on square linen canvas',
		description: 'Right modular diptych canvas designed to interlock seamlessly along matching edge letters.',
		widthCm: 60,
		heightCm: 60,
		imageUrl: '/demo-targets/painting-b.svg',
		trackabilityScore: 94,
		baseEdges: { ...DEFAULT_BASE_EDGES }
	},
	experiences: {
		A: {
			id: 'exp-pair01-aa',
			pairId: 'pair-01-equinox',
			seamLetter: 'A',
			type: 'shader_blend',
			title: 'Aurora Convergence (Seam AA)',
			assetPath: null,
			params: {
				speed: 1.15,
				intensity: 0.85,
				waveFrequency: 3.5,
				seamWidth: 0.36,
				accentColor: [0.22, 0.92, 0.74],
				subtitle: 'Harmonic northern current bridging North edges (A ↔ A)'
			},
			status: 'ready',
			isActive: true,
			version: 1
		},
		B: {
			id: 'exp-pair01-bb',
			pairId: 'pair-01-equinox',
			seamLetter: 'B',
			type: 'shader_blend',
			title: 'Solar Corona Pulse (Seam BB)',
			assetPath: null,
			params: {
				speed: 1.6,
				intensity: 1.0,
				waveFrequency: 5.0,
				seamWidth: 0.42,
				accentColor: [1.0, 0.58, 0.18],
				subtitle: 'Radiant plasma vortex across East edges (B ↔ B)'
			},
			status: 'ready',
			isActive: true,
			version: 1
		},
		C: {
			id: 'exp-pair01-cc',
			pairId: 'pair-01-equinox',
			seamLetter: 'C',
			type: 'shader_blend',
			title: 'Abyssal Ripple (Seam CC)',
			assetPath: null,
			params: {
				speed: 0.85,
				intensity: 0.75,
				waveFrequency: 2.8,
				seamWidth: 0.38,
				accentColor: [0.28, 0.62, 1.0],
				subtitle: 'Deep tidal refraction linking West edges (C ↔ C)'
			},
			status: 'ready',
			isActive: true,
			version: 1
		},
		D: {
			id: 'exp-pair01-dd',
			pairId: 'pair-01-equinox',
			seamLetter: 'D',
			type: 'shader_blend',
			title: 'Violet Singularity (Seam DD)',
			assetPath: null,
			params: {
				speed: 1.35,
				intensity: 0.92,
				waveFrequency: 4.2,
				seamWidth: 0.4,
				accentColor: [0.82, 0.35, 1.0],
				subtitle: 'Gravitational fold uniting South edges (D ↔ D)'
			},
			status: 'ready',
			isActive: true,
			version: 1
		}
	}
};
