<script lang="ts">
	import type {
		AxisConvention,
		NormalizedModelSpec,
		PivotPoint,
		PlacementMode,
	} from "../manifest/types";
	import { defaultPivotForMode } from "../manifest/repository";
	import { composeCalibrationRotation } from "../3d/modelNormalization";

	type GestureMode = "rotate" | "roll" | "move";

	interface TargetOption {
		id: string;
		label: string;
	}

	interface Props {
		targets: TargetOption[];
		selectedTargetId: string;
		spec: NormalizedModelSpec;
		wireframe: boolean;
		opacity: number;
		gestureMode?: GestureMode;
		canUndo: boolean;
		saving?: boolean;
		statusMessage?: string | null;
		onSelectTarget: (id: string) => void;
		onBeginEdit?: () => void;
		onChangeSpec: (next: NormalizedModelSpec, pushUndo?: boolean) => void;
		onChangeGestureMode?: (mode: GestureMode) => void;
		onToggleWireframe: (next: boolean) => void;
		onChangeOpacity: (next: number) => void;
		onUndo: () => void;
		onReset: () => void;
		onCopyJson: () => void;
		onSave: () => void;
		onClose: () => void;
	}

	let {
		targets,
		selectedTargetId,
		spec,
		wireframe,
		opacity,
		gestureMode = "rotate",
		canUndo,
		saving = false,
		statusMessage = null,
		onSelectTarget,
		onBeginEdit,
		onChangeSpec,
		onChangeGestureMode,
		onToggleWireframe,
		onChangeOpacity,
		onUndo,
		onReset,
		onCopyJson,
		onSave,
		onClose,
	}: Props = $props();

	let collapsed = $state(false);
	let activeTab = $state<"transform" | "orient">("transform");

	const MODES: PlacementMode[] = ["overlay", "standout", "inside"];
	const PIVOTS: PivotPoint[] = ["front", "base", "center", "back"];

	function roundTo(v: number, decimals = 3): number {
		const f = Math.pow(10, decimals);
		return Math.round(v * f) / f;
	}

	function wrapDeg(deg: number): number {
		let d = ((((deg + 180) % 360) + 360) % 360) - 180;
		if (Math.abs(d + 180) < 1e-6 && deg > 0) d = 180;
		const rounded = Math.round(d * 10) / 10;
		return rounded === 0 ? 0 : rounded;
	}

	function formatDeg(deg: number): string {
		return Number.isInteger(deg) ? String(deg) : deg.toFixed(1);
	}

	function applyQuickFlipRotation(
		dPitchDeg: number,
		dYawDeg: number,
		dRollDeg: number,
	) {
		onChangeSpec(
			{
				...spec,
				rotation: composeCalibrationRotation(
					spec.rotation,
					dPitchDeg,
					dYawDeg,
					dRollDeg,
				),
			},
			true,
		);
	}

	function setScale(val: number, pushUndo = false) {
		onChangeSpec(
			{ ...spec, scale: roundTo(Math.max(0.05, Math.min(5, val)), 3) },
			pushUndo,
		);
	}

	function setDepthScale(val: number, pushUndo = false) {
		onChangeSpec(
			{
				...spec,
				depthScale: roundTo(Math.max(0.05, Math.min(5, val)), 3),
			},
			pushUndo,
		);
	}

	function setOffsetAxis(axis: 0 | 1 | 2, val: number, pushUndo = false) {
		const nextOffset: [number, number, number] = [...spec.offset];
		nextOffset[axis] = roundTo(val, 3);
		onChangeSpec({ ...spec, offset: nextOffset }, pushUndo);
	}

	function setRotationAxis(axis: 0 | 1 | 2, deg: number, pushUndo = false) {
		const nextRot: [number, number, number] = [...spec.rotation];
		nextRot[axis] = wrapDeg(deg);
		onChangeSpec({ ...spec, rotation: nextRot }, pushUndo);
	}

	function snapRotationAxis90(axis: 0 | 1 | 2) {
		const snapped = Math.round(spec.rotation[axis] / 90) * 90;
		setRotationAxis(axis, snapped, true);
	}

	function toggleFlipAxis(axis: 0 | 1 | 2) {
		const nextFlip: [boolean, boolean, boolean] = [...spec.flip];
		nextFlip[axis] = !nextFlip[axis];
		onChangeSpec({ ...spec, flip: nextFlip }, true);
	}

	function setMode(mode: PlacementMode) {
		onChangeSpec(
			{
				...spec,
				mode,
				pivot: defaultPivotForMode(mode),
			},
			true,
		);
	}

	function setAxisConvention(axisConvention: AxisConvention) {
		onChangeSpec({ ...spec, axisConvention }, true);
	}
</script>

<section
	class="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-2xl px-2.5 pb-[max(0.65rem,env(safe-area-inset-bottom))]"
>
	<div
		class="overflow-hidden rounded-3xl border border-amber-400/30 bg-zinc-950/92 text-xs text-zinc-200 shadow-2xl backdrop-blur-xl"
	>
		<!-- Header Bar -->
		<div
			class="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3.5 py-2.5"
		>
			<div class="flex flex-wrap items-center gap-2 min-w-0">
				<span
					class="rounded-full bg-amber-500/20 px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider text-amber-300 uppercase"
				>
					Dev Calibrate
				</span>
				<div
					class="flex rounded-xl border border-white/10 bg-zinc-900 p-0.5"
				>
					{#each [{ id: "rotate" as const, label: "Rotate 3D" }, { id: "roll" as const, label: "Roll Z" }, { id: "move" as const, label: "Move XY" }] as modeOpt}
						<button
							type="button"
							onclick={() => onChangeGestureMode?.(modeOpt.id)}
							class="rounded-lg px-2 py-0.5 text-[10px] font-semibold transition-colors {gestureMode ===
							modeOpt.id
								? 'bg-amber-500/25 text-amber-200'
								: 'text-zinc-400 hover:text-white'}"
						>
							{modeOpt.label}
						</button>
					{/each}
				</div>
			</div>

			<div class="flex shrink-0 items-center gap-1.5">
				{#if statusMessage}
					<span
						class="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-300"
					>
						{statusMessage}
					</span>
				{/if}
				<button
					type="button"
					onclick={() => (collapsed = !collapsed)}
					class="rounded-xl border border-white/15 bg-zinc-900 px-2.5 py-1 text-[11px] font-semibold text-zinc-200 hover:bg-zinc-800"
				>
					{collapsed ? "Expand" : "Hide"}
				</button>
				<button
					type="button"
					onclick={onClose}
					class="rounded-xl border border-white/15 bg-zinc-900 px-2.5 py-1 text-[11px] font-semibold text-zinc-300 hover:bg-zinc-800"
				>
					Done
				</button>
			</div>
		</div>

		{#if !collapsed}
			<div class="max-h-[46dvh] space-y-3 overflow-y-auto p-3.5">
				<!-- Target Selector -->
				<div class="flex gap-1.5 overflow-x-auto pb-0.5">
					{#each targets as target (target.id)}
						<button
							type="button"
							onclick={() => onSelectTarget(target.id)}
							class="shrink-0 rounded-xl border px-2.5 py-1.5 font-mono text-[11px] font-semibold transition-colors {selectedTargetId ===
							target.id
								? 'border-amber-400/60 bg-amber-500/25 text-amber-200'
								: 'border-white/10 bg-zinc-900/90 text-zinc-400 hover:text-white'}"
						>
							{target.label}
						</button>
					{/each}
				</div>

				<!-- Tabs + Visibility Helpers -->
				<div class="flex flex-wrap items-center justify-between gap-2">
					<div
						class="flex rounded-xl border border-white/10 bg-zinc-900 p-0.5"
					>
						<button
							type="button"
							onclick={() => (activeTab = "transform")}
							class="rounded-lg px-3 py-1 text-[11px] font-semibold {activeTab ===
							'transform'
								? 'bg-zinc-800 text-white'
								: 'text-zinc-400'}"
						>
							Pos · Scale · Rot
						</button>
						<button
							type="button"
							onclick={() => (activeTab = "orient")}
							class="rounded-lg px-3 py-1 text-[11px] font-semibold {activeTab ===
							'orient'
								? 'bg-zinc-800 text-white'
								: 'text-zinc-400'}"
						>
							Axis · Flip · Pivot
						</button>
					</div>

					<div class="flex items-center gap-2">
						<button
							type="button"
							onclick={() => onToggleWireframe(!wireframe)}
							class="rounded-xl border px-2.5 py-1 text-[11px] font-semibold {wireframe
								? 'border-sky-400/60 bg-sky-500/20 text-sky-300'
								: 'border-white/15 bg-zinc-900 text-zinc-300'}"
						>
							Wire
						</button>
						<label
							class="flex items-center gap-1.5 text-[11px] text-zinc-300"
						>
							<span>Alpha</span>
							<input
								type="range"
								min="0.1"
								max="1"
								step="0.05"
								value={opacity}
								oninput={(e) =>
									onChangeOpacity(
										Number(e.currentTarget.value),
									)}
								class="w-16 accent-sky-400"
							/>
						</label>
					</div>
				</div>

				{#if activeTab === "transform"}
					<!-- Uniform Scale & Depth Scale -->
					<div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
						<div
							class="rounded-2xl border border-white/10 bg-zinc-900/75 p-2.5"
						>
							<div
								class="flex items-center justify-between text-[11px]"
							>
								<span class="font-semibold text-zinc-200"
									>Uniform Scale</span
								>
								<span class="font-mono text-sky-300"
									>{spec.scale.toFixed(3)}</span
								>
							</div>
							<input
								type="range"
								min="0.1"
								max="3.0"
								step="0.01"
								value={spec.scale}
								onpointerdown={() => onBeginEdit?.()}
								oninput={(e) =>
									setScale(Number(e.currentTarget.value))}
								class="mt-1.5 w-full accent-sky-400"
							/>
							<div
								class="mt-1.5 flex justify-between gap-1 font-mono text-[10px]"
							>
								<button
									type="button"
									onclick={() =>
										setScale(spec.scale - 0.05, true)}
									class="flex-1 rounded-lg bg-zinc-800 py-1 hover:bg-zinc-700"
									>-0.05</button
								>
								<button
									type="button"
									onclick={() =>
										setScale(spec.scale - 0.01, true)}
									class="flex-1 rounded-lg bg-zinc-800 py-1 hover:bg-zinc-700"
									>-0.01</button
								>
								<button
									type="button"
									onclick={() => setScale(1.0, true)}
									class="flex-1 rounded-lg bg-zinc-800 py-1 text-zinc-400 hover:bg-zinc-700"
									>1.0</button
								>
								<button
									type="button"
									onclick={() =>
										setScale(spec.scale + 0.01, true)}
									class="flex-1 rounded-lg bg-zinc-800 py-1 hover:bg-zinc-700"
									>+0.01</button
								>
								<button
									type="button"
									onclick={() =>
										setScale(spec.scale + 0.05, true)}
									class="flex-1 rounded-lg bg-zinc-800 py-1 hover:bg-zinc-700"
									>+0.05</button
								>
							</div>
						</div>

						<div
							class="rounded-2xl border border-white/10 bg-zinc-900/75 p-2.5"
						>
							<div
								class="flex items-center justify-between text-[11px]"
							>
								<span class="font-semibold text-zinc-200"
									>Depth Scale (Z)</span
								>
								<span class="font-mono text-emerald-300"
									>{spec.depthScale.toFixed(3)}</span
								>
							</div>
							<input
								type="range"
								min="0.1"
								max="3.0"
								step="0.01"
								value={spec.depthScale}
								onpointerdown={() => onBeginEdit?.()}
								oninput={(e) =>
									setDepthScale(
										Number(e.currentTarget.value),
									)}
								class="mt-1.5 w-full accent-emerald-400"
							/>
							<div
								class="mt-1.5 flex justify-between gap-1 font-mono text-[10px]"
							>
								<button
									type="button"
									onclick={() =>
										setDepthScale(
											spec.depthScale - 0.1,
											true,
										)}
									class="flex-1 rounded-lg bg-zinc-800 py-1 hover:bg-zinc-700"
									>-0.1</button
								>
								<button
									type="button"
									onclick={() => setDepthScale(1.0, true)}
									class="flex-1 rounded-lg bg-zinc-800 py-1 text-zinc-400 hover:bg-zinc-700"
									>1.0</button
								>
								<button
									type="button"
									onclick={() =>
										setDepthScale(
											spec.depthScale + 0.1,
											true,
										)}
									class="flex-1 rounded-lg bg-zinc-800 py-1 hover:bg-zinc-700"
									>+0.1</button
								>
							</div>
						</div>
					</div>

					<!-- Position Offset X / Y / Z (Z = depth toward camera) -->
					<div
						class="space-y-1.5 rounded-2xl border border-white/10 bg-zinc-900/75 p-2.5"
					>
						<div class="text-[11px] font-semibold text-zinc-200">
							Offset (canvas widths; +Z toward viewer)
						</div>
						{#each [{ axis: 0 as const, label: "X", accent: "accent-rose-400", text: "text-rose-300" }, { axis: 1 as const, label: "Y", accent: "accent-emerald-400", text: "text-emerald-300" }, { axis: 2 as const, label: "Z (Depth)", accent: "accent-sky-400", text: "text-sky-300" }] as row}
							<div class="flex items-center gap-2">
								<span
									class="w-16 font-mono text-[10px] {row.text}"
									>{row.label}</span
								>
								<input
									type="range"
									min="-1.5"
									max="1.5"
									step="0.005"
									value={spec.offset[row.axis]}
									onpointerdown={() => onBeginEdit?.()}
									oninput={(e) =>
										setOffsetAxis(
											row.axis,
											Number(e.currentTarget.value),
										)}
									class="flex-1 {row.accent}"
								/>
								<span
									class="w-12 text-right font-mono text-[10px] text-zinc-300"
								>
									{spec.offset[row.axis].toFixed(3)}
								</span>
								<button
									type="button"
									onclick={() =>
										setOffsetAxis(row.axis, 0, true)}
									class="rounded-md bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400 hover:text-white"
								>
									0
								</button>
							</div>
						{/each}
					</div>

					<!-- Per-axis Rotation (degrees) + Quick Flip Presets & 90 deg Snap Buttons -->
					<div
						class="space-y-1.5 rounded-2xl border border-white/10 bg-zinc-900/75 p-2.5"
					>
						<div
							class="flex flex-wrap items-center justify-between gap-1.5"
						>
							<div
								class="text-[11px] font-semibold text-zinc-200"
							>
								Rotation (degrees)
							</div>
							<div
								class="flex flex-wrap gap-1 font-mono text-[10px]"
							>
								<button
									type="button"
									onclick={() =>
										applyQuickFlipRotation(0, 0, 180)}
									class="rounded-md border border-sky-500/30 bg-sky-500/15 px-1.5 py-0.5 text-sky-300 hover:bg-sky-500/25"
								>
									Flip Upside-Down (Z +180°)
								</button>
								<button
									type="button"
									onclick={() =>
										applyQuickFlipRotation(180, 0, 0)}
									class="rounded-md bg-zinc-800 px-1.5 py-0.5 text-rose-300 hover:bg-zinc-700"
								>
									Flip X +180°
								</button>
								<button
									type="button"
									onclick={() =>
										applyQuickFlipRotation(0, 180, 0)}
									class="rounded-md bg-zinc-800 px-1.5 py-0.5 text-emerald-300 hover:bg-zinc-700"
								>
									Flip Y +180°
								</button>
								<button
									type="button"
									onclick={() =>
										onChangeSpec(
											{ ...spec, rotation: [0, 0, 0] },
											true,
										)}
									class="rounded-md bg-zinc-800 px-1.5 py-0.5 text-zinc-300 hover:bg-zinc-700"
								>
									Reset Rot (0,0,0)
								</button>
							</div>
						</div>
						{#each [{ axis: 0 as const, label: "Rot X", accent: "accent-rose-400", text: "text-rose-300" }, { axis: 1 as const, label: "Rot Y", accent: "accent-emerald-400", text: "text-emerald-300" }, { axis: 2 as const, label: "Rot Z", accent: "accent-sky-400", text: "text-sky-300" }] as row}
							<div class="flex flex-wrap items-center gap-1.5">
								<span
									class="w-11 font-mono text-[10px] {row.text}"
									>{row.label}</span
								>
								<input
									type="range"
									min="-180"
									max="180"
									step="0.5"
									value={spec.rotation[row.axis]}
									onpointerdown={() => onBeginEdit?.()}
									oninput={(e) =>
										setRotationAxis(
											row.axis,
											Number(e.currentTarget.value),
										)}
									class="min-w-[95px] flex-1 {row.accent}"
								/>
								<span
									class="w-12 text-right font-mono text-[10px] text-zinc-300"
								>
									{formatDeg(spec.rotation[row.axis])}°
								</span>
								<div class="flex gap-1 font-mono text-[10px]">
									<button
										type="button"
										onclick={() =>
											setRotationAxis(
												row.axis,
												spec.rotation[row.axis] - 90,
												true,
											)}
										class="rounded-md bg-zinc-800 px-1.5 py-0.5 hover:bg-zinc-700"
									>
										-90°
									</button>
									<button
										type="button"
										onclick={() =>
											snapRotationAxis90(row.axis)}
										class="rounded-md bg-zinc-800 px-1.5 py-0.5 text-amber-300 hover:bg-zinc-700"
									>
										Snap
									</button>
									<button
										type="button"
										onclick={() =>
											setRotationAxis(row.axis, 0, true)}
										class="rounded-md bg-zinc-800 px-1.5 py-0.5 text-zinc-400 hover:bg-zinc-700"
									>
										0°
									</button>
									<button
										type="button"
										onclick={() =>
											setRotationAxis(
												row.axis,
												spec.rotation[row.axis] + 90,
												true,
											)}
										class="rounded-md bg-zinc-800 px-1.5 py-0.5 hover:bg-zinc-700"
									>
										+90°
									</button>
								</div>
							</div>
						{/each}
					</div>
				{:else}
					<!-- Mode, Pivot, Axis Convention, Per-axis Flip -->
					<div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
						<div
							class="rounded-2xl border border-white/10 bg-zinc-900/75 p-2.5"
						>
							<div
								class="mb-1.5 text-[11px] font-semibold text-zinc-200"
							>
								Placement Mode
							</div>
							<div class="flex gap-1.5">
								{#each MODES as m}
									<button
										type="button"
										onclick={() => setMode(m)}
										class="flex-1 rounded-xl border py-1.5 text-[11px] font-semibold capitalize {spec.mode ===
										m
											? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-300'
											: 'border-white/10 bg-zinc-800/80 text-zinc-400'}"
									>
										{m}
									</button>
								{/each}
							</div>

							<div
								class="mt-2.5 mb-1.5 text-[11px] font-semibold text-zinc-200"
							>
								Pivot Point
							</div>
							<div class="grid grid-cols-4 gap-1">
								{#each PIVOTS as p}
									<button
										type="button"
										onclick={() =>
											onChangeSpec(
												{ ...spec, pivot: p },
												true,
											)}
										class="rounded-xl border py-1 text-[10px] font-semibold capitalize {spec.pivot ===
										p
											? 'border-sky-400/60 bg-sky-500/20 text-sky-300'
											: 'border-white/10 bg-zinc-800/80 text-zinc-400'}"
									>
										{p}
									</button>
								{/each}
							</div>
						</div>

						<div
							class="rounded-2xl border border-white/10 bg-zinc-900/75 p-2.5"
						>
							<div
								class="mb-1.5 text-[11px] font-semibold text-zinc-200"
							>
								Axis Convention
							</div>
							<div class="flex gap-1.5">
								{#each [{ id: "yUp" as const, label: "Y-up (glTF / Maya)" }, { id: "zUp" as const, label: "Z-up (Blender / CAD)" }] as conv}
									<button
										type="button"
										onclick={() =>
											setAxisConvention(conv.id)}
										class="flex-1 rounded-xl border py-1.5 text-[10px] font-semibold {spec.axisConvention ===
										conv.id
											? 'border-amber-400/60 bg-amber-500/20 text-amber-200'
											: 'border-white/10 bg-zinc-800/80 text-zinc-400'}"
									>
										{conv.label}
									</button>
								{/each}
							</div>

							<div
								class="mt-2.5 mb-1.5 text-[11px] font-semibold text-zinc-200"
							>
								Axis Flip
							</div>
							<div class="grid grid-cols-3 gap-1.5">
								{#each [{ axis: 0 as const, label: "Flip X" }, { axis: 1 as const, label: "Flip Y" }, { axis: 2 as const, label: "Flip Z" }] as f}
									<button
										type="button"
										onclick={() => toggleFlipAxis(f.axis)}
										class="rounded-xl border py-1.5 text-[11px] font-semibold {spec
											.flip[f.axis]
											? 'border-rose-400/60 bg-rose-500/20 text-rose-300'
											: 'border-white/10 bg-zinc-800/80 text-zinc-400'}"
									>
										{f.label}: {spec.flip[f.axis]
											? "ON"
											: "OFF"}
									</button>
								{/each}
							</div>
						</div>
					</div>
				{/if}

				<!-- Numeric Readout -->
				<div
					class="rounded-2xl border border-white/10 bg-black/50 p-2 font-mono text-[10px] leading-relaxed text-zinc-300"
				>
					<div>
						mode=<span class="text-emerald-300">{spec.mode}</span> ·
						pivot=<span class="text-sky-300">{spec.pivot}</span> ·
						axis=<span class="text-amber-300"
							>{spec.axisConvention}</span
						>
						· scale=<span class="text-white"
							>{spec.scale.toFixed(3)}</span
						>
						· depthScale=<span class="text-white"
							>{spec.depthScale.toFixed(3)}</span
						>
					</div>
					<div>
						offset=[{spec.offset
							.map((v) => v.toFixed(3))
							.join(", ")}] · rot=[{spec.rotation
							.map(formatDeg)
							.join(", ")}]° · flip=[{spec.flip.join(", ")}]
					</div>
				</div>

				<!-- Footer Actions -->
				<div
					class="flex flex-wrap items-center justify-between gap-2 pt-0.5"
				>
					<div class="flex gap-1.5">
						<button
							type="button"
							onclick={onUndo}
							disabled={!canUndo}
							class="rounded-xl border border-white/15 bg-zinc-900 px-3 py-2 text-[11px] font-semibold text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
						>
							Undo
						</button>
						<button
							type="button"
							onclick={onReset}
							class="rounded-xl border border-white/15 bg-zinc-900 px-3 py-2 text-[11px] font-semibold text-zinc-200 hover:bg-zinc-800"
						>
							Reset
						</button>
					</div>

					<div class="flex gap-1.5">
						<button
							type="button"
							onclick={onCopyJson}
							class="rounded-xl border border-sky-500/40 bg-sky-500/20 px-3 py-2 text-[11px] font-semibold text-sky-300 hover:bg-sky-500/30"
						>
							Copy JSON
						</button>
						<button
							type="button"
							onclick={onSave}
							disabled={saving}
							class="rounded-xl border border-emerald-500/50 bg-emerald-500/25 px-4 py-2 text-[11px] font-bold text-emerald-200 hover:bg-emerald-500/35 disabled:opacity-50"
						>
							{saving ? "Saving…" : "Save"}
						</button>
					</div>
				</div>
			</div>
		{/if}
	</div>
</section>
