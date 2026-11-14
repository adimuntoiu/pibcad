<script lang="ts">
	import type { Point } from '#lib/types';

	interface Props {
		/** Normalized corners in the camera frame. */
		corners: Point[] | null;
		videoWidth: number;
		videoHeight: number;
		/** Size of the on-screen box the video fills with `object-cover`. */
		width: number;
		height: number;
	}

	let { corners, videoWidth, videoHeight, width, height }: Props = $props();

	// Map normalized camera-frame coordinates to screen pixels, matching `object-fit: cover`.
	const points = $derived.by(() => {
		if (!corners || !videoWidth || !videoHeight || !width || !height) return [];
		const scale = Math.max(width / videoWidth, height / videoHeight);
		const offsetX = (videoWidth * scale - width) / 2;
		const offsetY = (videoHeight * scale - height) / 2;
		return corners.map((p) => ({
			x: p.x * videoWidth * scale - offsetX,
			y: p.y * videoHeight * scale - offsetY
		}));
	});
</script>

{#if points.length === 4}
	<svg class="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 {width} {height}">
		<polygon
			points={points.map((p) => `${p.x},${p.y}`).join(' ')}
			fill="none"
			stroke="#34d399"
			stroke-opacity="0.6"
			stroke-width="2"
		/>
		{#each points as p}
			<circle cx={p.x} cy={p.y} r="11" fill="#34d399" stroke="#022c22" stroke-width="3" />
		{/each}
	</svg>
{/if}
