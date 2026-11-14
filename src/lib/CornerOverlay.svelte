<script lang="ts">
	import type { Point } from '#lib/types';
	import type { TrackedPainting } from '#lib/recognition/scanner.svelte';
	import type { ArtManifest, CanvasEdgeMap } from './manifest/types';
	import { resolveCanvasConfig } from './manifest/repository';
	import type { SeamDiagnostics } from './3d/ModelARCanvas.svelte';

	interface Props {
		/** Multiple tracked paintings, or null/empty. */
		paintings?: TrackedPainting[];
		/** Single painting corners fallback. */
		corners?: Point[] | null;
		manifest?: ArtManifest | null;
		activeSeam?: SeamDiagnostics | null;
		videoWidth: number;
		videoHeight: number;
		/** Size of the on-screen box the video fills with `object-cover`. */
		width: number;
		height: number;
	}

	let {
		paintings = [],
		corners = null,
		manifest = null,
		activeSeam = null,
		videoWidth,
		videoHeight,
		width,
		height
	}: Props = $props();

	const DEFAULT_EDGES: CanvasEdgeMap = { top: 'A', right: 'B', bottom: 'D', left: 'C' };

	const PALETTE = [
		{ stroke: '#34d399', dot: '#34d399', dark: '#022c22', bg: 'rgba(6, 78, 59, 0.88)', text: '#6ee7b7' },
		{ stroke: '#38bdf8', dot: '#38bdf8', dark: '#082f49', bg: 'rgba(12, 74, 110, 0.88)', text: '#7dd3fc' },
		{ stroke: '#a78bfa', dot: '#a78bfa', dark: '#2e1065', bg: 'rgba(76, 29, 149, 0.88)', text: '#c4b5fd' },
		{ stroke: '#fbbf24', dot: '#fbbf24', dark: '#451a03', bg: 'rgba(120, 53, 15, 0.88)', text: '#fde68a' }
	];

	const renderedQuads = $derived.by(() => {
		if (!videoWidth || !videoHeight || !width || !height) return [];

		const scale = Math.max(width / videoWidth, height / videoHeight);
		const offsetX = (videoWidth * scale - width) / 2;
		const offsetY = (videoHeight * scale - height) / 2;

		const list: {
			id: string;
			title: string;
			points: Point[];
			edgeMidpoints: { label: string; x: number; y: number; isPrimary: boolean }[];
			badgeX: number;
			badgeY: number;
			color: (typeof PALETTE)[0];
		}[] = [];

		const pushQuad = (id: string, title: string, rawCorners: Point[], idx: number) => {
			if (rawCorners.length !== 4) return;
			const pts = rawCorners.map((pt) => ({
				x: pt.x * videoWidth * scale - offsetX,
				y: pt.y * videoHeight * scale - offsetY
			}));
			const cfg = manifest ? resolveCanvasConfig(manifest, id) : null;
			const edges = cfg?.edges ?? DEFAULT_EDGES;
			const edgeMidpoints = [
				{
					label: edges.top,
					x: (pts[0].x + pts[1].x) / 2,
					y: (pts[0].y + pts[1].y) / 2,
					isPrimary: true
				},
				{
					label: edges.right,
					x: (pts[1].x + pts[2].x) / 2,
					y: (pts[1].y + pts[2].y) / 2,
					isPrimary: false
				},
				{
					label: edges.bottom,
					x: (pts[2].x + pts[3].x) / 2,
					y: (pts[2].y + pts[3].y) / 2,
					isPrimary: false
				},
				{
					label: edges.left,
					x: (pts[3].x + pts[0].x) / 2,
					y: (pts[3].y + pts[0].y) / 2,
					isPrimary: false
				}
			];
			const meanX = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
			const topScreenY = Math.min(pts[0].y, pts[1].y, pts[2].y, pts[3].y);
			list.push({
				id: cfg?.id ?? id,
				title: cfg?.name ?? title,
				points: pts,
				edgeMidpoints,
				badgeX: meanX,
				badgeY: Math.max(20, topScreenY - 18),
				color: PALETTE[idx % PALETTE.length]
			});
		};

		if (paintings && paintings.length > 0) {
			paintings.forEach((p, idx) => {
				pushQuad(p.id, p.title, p.corners, idx);
			});
		} else if (corners && corners.length === 4) {
			pushQuad('single', '', corners, 0);
		}

		return list;
	});

	const SIDE_INDEX: Record<string, number> = {
		top: 0,
		right: 1,
		bottom: 2,
		left: 3
	};

	const seamOverlay = $derived.by(() => {
		if (!activeSeam || renderedQuads.length < 2) return null;
		const quadA = renderedQuads.find((q) => q.id === activeSeam.canvasAId) ?? renderedQuads[0];
		const quadB =
			renderedQuads.find((q) => q !== quadA && q.id === activeSeam.canvasBId) ?? renderedQuads[1];
		if (!quadA || !quadB) return null;

		const ptA = quadA.edgeMidpoints[SIDE_INDEX[activeSeam.sideA] ?? 1];
		const ptB = quadB.edgeMidpoints[SIDE_INDEX[activeSeam.sideB] ?? 3];
		if (!ptA || !ptB) return null;

		return {
			x1: ptA.x,
			y1: ptA.y,
			x2: ptB.x,
			y2: ptB.y,
			mx: (ptA.x + ptB.x) * 0.5,
			my: (ptA.y + ptB.y) * 0.5,
			compatible: activeSeam.isCompatible,
			label: `${activeSeam.pairCode} · ${activeSeam.isCompatible ? 'VALID' : 'SINGLE'}`
		};
	});
</script>

{#if renderedQuads.length > 0}
	<svg class="pointer-events-none absolute inset-0 z-10 h-full w-full" viewBox="0 0 {width} {height}">
		{#each renderedQuads as quad, qIdx (`${quad.id}-${qIdx}`)}
			{@const pts = quad.points}
			<!-- Bounding Polygon -->
			<polygon
				points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
				fill="none"
				stroke={quad.color.stroke}
				stroke-opacity="0.8"
				stroke-width="2.5"
			/>

			<!-- Primary Top Edge Highlight (Canonical Edge A: corner 0 -> 1) -->
			<line
				x1={pts[0].x}
				y1={pts[0].y}
				x2={pts[1].x}
				y2={pts[1].y}
				stroke="#fbbf24"
				stroke-width="4"
				stroke-linecap="round"
				stroke-opacity="0.9"
			/>

			<!-- 4 Corner Circles (corner 0 highlighted amber as TL reference) -->
			{#each pts as p, cIdx}
				<circle
					cx={p.x}
					cy={p.y}
					r={cIdx === 0 ? 8 : 6}
					fill={cIdx === 0 ? '#fbbf24' : quad.color.dot}
					stroke={quad.color.dark}
					stroke-width="2.5"
				/>
			{/each}

			<!-- Oriented Edge Labels (A/B/D/C rotating physically with the canvas) -->
			{#each quad.edgeMidpoints as edge}
				<g transform="translate({edge.x}, {edge.y})">
					<circle
						r="11"
						fill={edge.isPrimary ? 'rgba(120, 53, 15, 0.92)' : 'rgba(9, 9, 11, 0.85)'}
						stroke={edge.isPrimary ? '#fbbf24' : quad.color.stroke}
						stroke-width="1.5"
					/>
					<text
						x="0"
						y="4"
						text-anchor="middle"
						fill={edge.isPrimary ? '#fde68a' : '#f4f4f5'}
						font-size="11"
						font-weight="800"
					>
						{edge.label}
					</text>
				</g>
			{/each}

			<!-- Title badge anchored above screen top edge -->
			{#if quad.title}
				<g transform="translate({quad.badgeX}, {quad.badgeY})">
					<rect
						x="-76"
						y="-12"
						width="152"
						height="22"
						rx="11"
						fill={quad.color.bg}
						stroke={quad.color.stroke}
						stroke-width="1.2"
					/>
					<text
						x="0"
						y="3"
						text-anchor="middle"
						fill={quad.color.text}
						font-size="11"
						font-weight="700"
						letter-spacing="0.2"
					>
						{quad.title.length > 20 ? quad.title.slice(0, 18) + '…' : quad.title}
					</text>
				</g>
			{/if}
		{/each}

		{#if seamOverlay}
			<line
				x1={seamOverlay.x1}
				y1={seamOverlay.y1}
				x2={seamOverlay.x2}
				y2={seamOverlay.y2}
				stroke={seamOverlay.compatible ? '#34d399' : '#fb7185'}
				stroke-width="3"
				stroke-dasharray="6 4"
				stroke-linecap="round"
			/>
			<g transform="translate({seamOverlay.mx}, {seamOverlay.my})">
				<rect
					x="-46"
					y="-11"
					width="92"
					height="22"
					rx="11"
					fill={seamOverlay.compatible ? 'rgba(6, 78, 59, 0.94)' : 'rgba(76, 5, 25, 0.92)'}
					stroke={seamOverlay.compatible ? '#34d399' : '#fb7185'}
					stroke-width="1.5"
				/>
				<text
					x="0"
					y="4"
					text-anchor="middle"
					fill={seamOverlay.compatible ? '#a7f3d0' : '#fecdd3'}
					font-size="10.5"
					font-weight="800"
				>
					{seamOverlay.label}
				</text>
			</g>
		{/if}
	</svg>
{/if}
