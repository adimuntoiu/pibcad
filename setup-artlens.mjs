/**
 * ArtLens Scaffold Script (Windows / Cross-Platform Node.js)
 * Run from the root of your existing SvelteKit + Tailwind project:
 *   node setup-artlens.mjs
 */

import fs from 'node:fs';
import path from 'node:path';

const files = {
  'vite.config.ts': `import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
\tplugins: [sveltekit()],
\tserver: {
\t\thost: true,
\t\tallowedHosts: true,
\t\tproxy: {
\t\t\t'/api': {
\t\t\t\ttarget: 'http://127.0.0.1:8000',
\t\t\t\tchangeOrigin: true
\t\t\t}
\t\t}
\t}
});
`,

  'src/app.html': `<!doctype html>
<html lang="en" class="dark">
\t<head>
\t\t<meta charset="utf-8" />
\t\t<link rel="icon" href="%sveltekit.assets%/favicon.png" />
\t\t<meta
\t\t\tname="viewport"
\t\t\tcontent="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
\t\t/>
\t\t<meta name="theme-color" content="#000000" />
\t\t<title>ArtLens Scanner</title>
\t\t%sveltekit.head%
\t</head>
\t<body data-sveltekit-preload-data="hover" class="bg-black text-white antialiased select-none overflow-hidden">
\t\t<div style="display: contents">%sveltekit.body%</div>
\t</body>
</html>
`,

  'src/lib/types.ts': `export interface RecognitionResponse {
\tmatch: boolean;
\tid: string | null;
\ttitle: string | null;
\tartist: string | null;
\tconfidence: number;
}

export interface PaintingDetails {
\tid: string;
\ttitle: string;
\tartist: string;
\timage: string;
\timageUrl: string | null;
}

export type ScannerStatus =
\t| 'idle'
\t| 'starting_camera'
\t| 'scanning'
\t| 'detected'
\t| 'recognized'
\t| 'permission_denied'
\t| 'no_camera'
\t| 'backend_unreachable';
`,

  'src/lib/camera/camera.ts': `export type CameraErrorType = 'permission_denied' | 'no_camera' | 'unknown';

export class CameraSetupError extends Error {
\tconstructor(
\t\tpublic readonly type: CameraErrorType,
\t\tmessage: string
\t) {
\t\tsuper(message);
\t\tthis.name = 'CameraSetupError';
\t}
}

export async function startRearCamera(videoEl: HTMLVideoElement): Promise<MediaStream> {
\tif (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
\t\tthrow new CameraSetupError(
\t\t\t'no_camera',
\t\t\t'Camera API is unavailable. Ensure you are visiting over HTTPS.'
\t\t);
\t}

\ttry {
\t\tconst stream = await navigator.mediaDevices.getUserMedia({
\t\t\taudio: false,
\t\t\tvideo: {
\t\t\t\tfacingMode: { ideal: 'environment' },
\t\t\t\twidth: { ideal: 1280 },
\t\t\t\theight: { ideal: 720 }
\t\t\t}
\t\t});

\t\tvideoEl.srcObject = stream;
\t\tvideoEl.setAttribute('playsinline', 'true');
\t\tvideoEl.muted = true;

\t\tawait videoEl.play();
\t\treturn stream;
\t} catch (err) {
\t\tif (err instanceof DOMException) {
\t\t\tif (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
\t\t\t\tthrow new CameraSetupError(
\t\t\t\t\t'permission_denied',
\t\t\t\t\t'Camera permission was denied. Please allow camera access in your browser settings.'
\t\t\t\t);
\t\t\t}
\t\t\tif (
\t\t\t\terr.name === 'NotFoundError' ||
\t\t\t\terr.name === 'DevicesNotFoundError' ||
\t\t\t\terr.name === 'OverconstrainedError'
\t\t\t) {
\t\t\t\tthrow new CameraSetupError('no_camera', 'No suitable camera was found on this device.');
\t\t\t}
\t\t}
\t\tthrow new CameraSetupError(
\t\t\t'unknown',
\t\t\terr instanceof Error ? err.message : 'Unable to access the camera.'
\t\t);
\t}
}

export function stopCameraStream(stream: MediaStream | null, videoEl?: HTMLVideoElement | null): void {
\tif (stream) {
\t\tfor (const track of stream.getTracks()) {
\t\t\ttrack.stop();
\t\t}
\t}
\tif (videoEl) {
\t\tvideoEl.pause();
\t\tvideoEl.srcObject = null;
\t}
}

export class FrameCapturer {
\tprivate canvas: HTMLCanvasElement;
\tprivate ctx: CanvasRenderingContext2D;
\tprivate readonly maxLongSide: number;
\tprivate readonly jpegQuality: number;

\tconstructor(maxLongSide = 384, jpegQuality = 0.7) {
\t\tthis.maxLongSide = maxLongSide;
\t\tthis.jpegQuality = jpegQuality;
\t\tthis.canvas = document.createElement('canvas');
\t\tconst context = this.canvas.getContext('2d', { willReadFrequently: false });
\t\tif (!context) {
\t\t\tthrow new Error('Failed to create 2D canvas context');
\t\t}
\t\tthis.ctx = context;
\t}

\tasync captureJpegBlob(videoEl: HTMLVideoElement): Promise<Blob | null> {
\t\tconst vw = videoEl.videoWidth;
\t\tconst vh = videoEl.videoHeight;

\t\tif (!vw || !vh || videoEl.readyState < 2) {
\t\t\treturn null;
\t\t}

\t\tconst scale = this.maxLongSide / Math.max(vw, vh);
\t\tconst targetW = Math.max(1, Math.round(vw * scale));
\t\tconst targetH = Math.max(1, Math.round(vh * scale));

\t\tif (this.canvas.width !== targetW || this.canvas.height !== targetH) {
\t\t\tthis.canvas.width = targetW;
\t\t\tthis.canvas.height = targetH;
\t\t}

\t\tthis.ctx.drawImage(videoEl, 0, 0, targetW, targetH);

\t\treturn new Promise<Blob | null>((resolve) => {
\t\t\tthis.canvas.toBlob(
\t\t\t\t(blob) => {
\t\t\t\t\tresolve(blob);
\t\t\t\t},
\t\t\t\t'image/jpeg',
\t\t\t\tthis.jpegQuality
\t\t\t);
\t\t});
\t}
}
`,

  'src/lib/api/recognize.ts': `import type { PaintingDetails, RecognitionResponse } from '$lib/types';

export class BackendUnreachableError extends Error {
\tconstructor(message = 'Cannot reach recognition backend.') {
\t\tsuper(message);
\t\tthis.name = 'BackendUnreachableError';
\t}
}

export async function recognizeFrame(
\tblob: Blob,
\tsignal?: AbortSignal
): Promise<RecognitionResponse> {
\tconst formData = new FormData();
\tformData.append('file', blob, 'frame.jpg');

\tlet response: Response;
\ttry {
\t\tresponse = await fetch('/api/recognize', {
\t\t\tmethod: 'POST',
\t\t\tbody: formData,
\t\t\tsignal
\t\t});
\t} catch (err) {
\t\tif (err instanceof DOMException && err.name === 'AbortError') {
\t\t\tthrow err;
\t\t}
\t\tthrow new BackendUnreachableError();
\t}

\tif (response.status >= 500 || response.status === 502 || response.status === 503 || response.status === 504) {
\t\tthrow new BackendUnreachableError('Server error (' + response.status + ')');
\t}

\tif (!response.ok) {
\t\tthrow new Error('Recognition request failed with status ' + response.status);
\t}

\treturn (await response.json()) as RecognitionResponse;
}

export async function fetchPaintingDetails(id: string): Promise<PaintingDetails | null> {
\ttry {
\t\tconst res = await fetch('/api/paintings/' + encodeURIComponent(id));
\t\tif (!res.ok) return null;
\t\treturn (await res.json()) as PaintingDetails;
\t} catch {
\t\treturn null;
\t}
}
`,

  'src/lib/services/generate3d.ts': `export interface Generate3DResult {
\tstatus: 'mock';
\tmodelUrl: string | null;
}

/**
 * Stub service for generating a 3D relief/scene model from a recognized 2D painting.
 */
export async function generate3D(
\tpaintingId: string,
\timageUrl: string
): Promise<Generate3DResult> {
\tconsole.info('[generate3D stub] Called for paintingId="' + paintingId + '", imageUrl="' + imageUrl + '"');
\tawait new Promise((resolve) => setTimeout(resolve, 600));
\treturn {
\t\tstatus: 'mock',
\t\tmodelUrl: null
\t};
}
`,

  'src/lib/state/scanner.svelte.ts': `import { BackendUnreachableError, recognizeFrame } from '$lib/api/recognize';
import { CameraSetupError, FrameCapturer, startRearCamera, stopCameraStream } from '$lib/camera/camera';
import type { RecognitionResponse, ScannerStatus } from '$lib/types';

const CAPTURE_INTERVAL_MS = 500;
const REQUIRED_CONSECUTIVE_MATCHES = 3;
const CLEAR_AFTER_NO_MATCH_MS = 2000;

export interface RecognizedPainting {
\tid: string;
\ttitle: string;
\tartist: string;
\tconfidence: number;
}

export class ScannerController {
\tstatus = $state<ScannerStatus>('idle');
\terrorMessage = $state<string | null>(null);
\trecognized = $state<RecognizedPainting | null>(null);
\tisRequestInFlight = $state<boolean>(false);

\tprivate videoEl: HTMLVideoElement | null = null;
\tprivate stream: MediaStream | null = null;
\tprivate capturer: FrameCapturer | null = null;
\tprivate intervalId: ReturnType<typeof setInterval> | null = null;
\tprivate abortController: AbortController | null = null;

\tprivate candidateId: string | null = null;
\tprivate consecutiveCount = 0;
\tprivate lastMatchTimestamp = 0;

\tasync start(videoEl: HTMLVideoElement): Promise<void> {
\t\tthis.stop();
\t\tthis.videoEl = videoEl;
\t\tthis.status = 'starting_camera';
\t\tthis.errorMessage = null;

\t\ttry {
\t\t\tif (!this.capturer) {
\t\t\t\tthis.capturer = new FrameCapturer(384, 0.7);
\t\t\t}
\t\t\tthis.stream = await startRearCamera(videoEl);
\t\t\tthis.status = 'scanning';
\t\t\tthis.startPollingLoop();
\t\t} catch (err) {
\t\t\tif (err instanceof CameraSetupError) {
\t\t\t\tthis.status = err.type === 'permission_denied' ? 'permission_denied' : 'no_camera';
\t\t\t\tthis.errorMessage = err.message;
\t\t\t} else {
\t\t\t\tthis.status = 'no_camera';
\t\t\t\tthis.errorMessage = 'Could not start camera.';
\t\t\t}
\t\t}
\t}

\tstop(): void {
\t\tif (this.intervalId !== null) {
\t\t\tclearInterval(this.intervalId);
\t\t\tthis.intervalId = null;
\t\t}
\t\tif (this.abortController) {
\t\t\tthis.abortController.abort();
\t\t\tthis.abortController = null;
\t\t}
\t\tstopCameraStream(this.stream, this.videoEl);
\t\tthis.stream = null;
\t\tthis.isRequestInFlight = false;
\t\tthis.resetStabilization();
\t\tthis.status = 'idle';
\t}

\tasync handleVisibilityChange(): Promise<void> {
\t\tif (document.hidden) {
\t\t\tthis.stop();
\t\t}
\t}

\tprivate resetStabilization(): void {
\t\tthis.candidateId = null;
\t\tthis.consecutiveCount = 0;
\t\tthis.lastMatchTimestamp = 0;
\t\tthis.recognized = null;
\t}

\tprivate startPollingLoop(): void {
\t\tif (this.intervalId !== null) {
\t\t\tclearInterval(this.intervalId);
\t\t}
\t\tthis.intervalId = setInterval(() => {
\t\t\tvoid this.tick();
\t\t}, CAPTURE_INTERVAL_MS);
\t}

\tprivate async tick(): Promise<void> {
\t\tif (this.isRequestInFlight || !this.videoEl || !this.capturer) {
\t\t\treturn;
\t\t}

\t\tif (this.videoEl.paused && this.stream?.active) {
\t\t\ttry {
\t\t\t\tawait this.videoEl.play();
\t\t\t} catch {
\t\t\t\treturn;
\t\t\t}
\t\t}

\t\tthis.isRequestInFlight = true;
\t\tthis.abortController = new AbortController();

\t\ttry {
\t\t\tconst blob = await this.capturer.captureJpegBlob(this.videoEl);
\t\t\tif (!blob) {
\t\t\t\treturn;
\t\t\t}

\t\t\tconst res = await recognizeFrame(blob, this.abortController.signal);
\t\t\tthis.applyRecognitionResult(res);
\t\t} catch (err) {
\t\t\tif (err instanceof DOMException && err.name === 'AbortError') {
\t\t\t\treturn;
\t\t\t}
\t\t\tif (err instanceof BackendUnreachableError) {
\t\t\t\tthis.status = 'backend_unreachable';
\t\t\t\tthis.errorMessage = 'Backend server is unreachable. Check your connection.';
\t\t\t}
\t\t} finally {
\t\t\tthis.isRequestInFlight = false;
\t\t}
\t}

\tprivate applyRecognitionResult(res: RecognitionResponse): void {
\t\tconst now = performance.now();

\t\tif (res.match && res.id && res.title && res.artist) {
\t\t\tthis.lastMatchTimestamp = now;

\t\t\tif (this.candidateId === res.id) {
\t\t\t\tthis.consecutiveCount += 1;
\t\t\t} else {
\t\t\t\tthis.candidateId = res.id;
\t\t\t\tthis.consecutiveCount = 1;
\t\t\t}

\t\t\tif (this.consecutiveCount >= REQUIRED_CONSECUTIVE_MATCHES) {
\t\t\t\tthis.recognized = {
\t\t\t\t\tid: res.id,
\t\t\t\t\ttitle: res.title,
\t\t\t\t\tartist: res.artist,
\t\t\t\t\tconfidence: res.confidence
\t\t\t\t};
\t\t\t\tthis.status = 'recognized';
\t\t\t} else if (!this.recognized) {
\t\t\t\tthis.status = 'scanning';
\t\t\t}
\t\t} else {
\t\t\tthis.candidateId = null;
\t\t\tthis.consecutiveCount = 0;

\t\t\tif (this.recognized) {
\t\t\t\tif (now - this.lastMatchTimestamp >= CLEAR_AFTER_NO_MATCH_MS) {
\t\t\t\t\tthis.recognized = null;
\t\t\t\t\tthis.status = 'scanning';
\t\t\t\t}
\t\t\t} else {
\t\t\t\tthis.status = 'scanning';
\t\t\t}
\t\t}
\t}
}
`,

  'src/lib/components/CameraView.svelte': `<script lang="ts">
\tinterface Props {
\t\tvideoRef?: HTMLVideoElement | null;
\t\tactive: boolean;
\t}

\tlet { videoRef = $bindable(null), active }: Props = $props();
</script>

<div class="relative inset-0 h-dvh w-screen overflow-hidden bg-black">
\t<video
\t\tbind:this={videoRef}
\t\tplaysinline
\t\twebkit-playsinline="true"
\t\tmuted
\t\tautoplay
\t\tclass="h-full w-full object-cover transition-opacity duration-300 {active ? 'opacity-100' : 'opacity-0'}"
\t></video>

\t{#if active}
\t\t<div class="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-black/60"></div>
\t\t<div class="pointer-events-none absolute inset-0 flex items-center justify-center p-10">
\t\t\t<div class="relative aspect-[3/4] w-full max-w-xs">
\t\t\t\t<div class="absolute top-0 left-0 h-7 w-7 rounded-tl-xl border-t-2 border-l-2 border-white/60"></div>
\t\t\t\t<div class="absolute top-0 right-0 h-7 w-7 rounded-tr-xl border-t-2 border-r-2 border-white/60"></div>
\t\t\t\t<div class="absolute bottom-0 left-0 h-7 w-7 rounded-bl-xl border-b-2 border-l-2 border-white/60"></div>
\t\t\t\t<div class="absolute bottom-0 right-0 h-7 w-7 rounded-br-xl border-b-2 border-r-2 border-white/60"></div>
\t\t\t</div>
\t\t</div>
\t{/if}
</div>
`,

  'src/lib/components/StatusMessage.svelte': `<script lang="ts">
\timport type { ScannerStatus } from '$lib/types';

\tinterface Props {
\t\tstatus: ScannerStatus;
\t\terrorMessage: string | null;
\t\tonStart: () => void;
\t\tonStop: () => void;
\t}

\tlet { status, errorMessage, onStart, onStop }: Props = $props();
</script>

{#if status === 'scanning' || status === 'recognized' || status === 'backend_unreachable'}
\t<header class="fixed top-0 right-0 left-0 z-20 flex items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-3">
\t\t<div class="flex items-center gap-2.5 rounded-full border border-white/15 bg-black/70 px-4 py-2 text-sm font-medium text-white shadow-lg backdrop-blur-md">
\t\t\t{#if status === 'scanning'}
\t\t\t\t<span class="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-400"></span>
\t\t\t\t<span>Point the camera at a painting</span>
\t\t\t{:else if status === 'recognized'}
\t\t\t\t<span class="h-2.5 w-2.5 rounded-full bg-sky-400"></span>
\t\t\t\t<span>Painting recognized</span>
\t\t\t{:else if status === 'backend_unreachable'}
\t\t\t\t<span class="h-2.5 w-2.5 rounded-full bg-amber-400"></span>
\t\t\t\t<span>Backend unreachable — retrying…</span>
\t\t\t{/if}
\t\t</div>
\t\t<button type="button" onclick={onStop} class="rounded-full border border-white/15 bg-black/70 px-3.5 py-2 text-xs font-semibold text-white/90 backdrop-blur-md active:scale-95">
\t\t\tClose
\t\t</button>
\t</header>
{/if}

{#if status === 'idle' || status === 'starting_camera' || status === 'permission_denied' || status === 'no_camera'}
\t<div class="fixed inset-0 z-30 flex flex-col items-center justify-center bg-zinc-950/95 px-6 text-center">
\t\t<div class="w-full max-w-sm rounded-3xl border border-white/10 bg-zinc-900/90 p-7 shadow-2xl backdrop-blur-xl">
\t\t\t<div class="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10">
\t\t\t\t<svg class="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
\t\t\t\t\t<path stroke-linecap="round" stroke-linejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
\t\t\t\t\t<path stroke-linecap="round" stroke-linejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
\t\t\t\t</svg>
\t\t\t</div>
\t\t\t<h1 class="text-2xl font-bold tracking-tight text-white">ArtLens Scanner</h1>
\t\t\t<p class="mt-2 text-sm leading-relaxed text-zinc-400">
\t\t\t\tInstantly identify paintings in real time using your phone camera.
\t\t\t</p>
\t\t\t{#if status === 'permission_denied' || status === 'no_camera'}
\t\t\t\t<div class="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 p-3.5 text-left text-xs text-red-200">
\t\t\t\t\t<p class="font-semibold text-red-100">
\t\t\t\t\t\t{status === 'permission_denied' ? 'Camera Permission Denied' : 'Camera Unavailable'}
\t\t\t\t\t</p>
\t\t\t\t\t<p class="mt-1 opacity-90">{errorMessage}</p>
\t\t\t\t</div>
\t\t\t{/if}
\t\t\t<button type="button" disabled={status === 'starting_camera'} onclick={onStart} class="mt-6 w-full rounded-2xl bg-white py-3.5 text-base font-semibold text-black shadow-lg transition active:scale-[0.98] disabled:opacity-50">
\t\t\t\t{#if status === 'starting_camera'}
\t\t\t\t\tStarting camera…
\t\t\t\t{:else if status === 'permission_denied' || status === 'no_camera'}
\t\t\t\t\tTry Again
\t\t\t\t{:else}
\t\t\t\t\tStart scanning
\t\t\t\t{/if}
\t\t\t</button>
\t\t</div>
\t</div>
{/if}
`,

  'src/lib/components/ResultSheet.svelte': `<script lang="ts">
\timport { generate3D } from '$lib/services/generate3d';
\timport type { RecognizedPainting } from '$lib/state/scanner.svelte';

\tinterface Props {
\t\tpainting: RecognizedPainting | null;
\t}

\tlet { painting }: Props = $props();

\tlet isGenerating3D = $state(false);
\tlet comingSoonToast = $state<string | null>(null);

\t$effect(() => {
\t\tif (!painting) {
\t\t\tcomingSoonToast = null;
\t\t\tisGenerating3D = false;
\t\t}
\t});

\tasync function handleGenerate3D() {
\t\tif (!painting || isGenerating3D) return;
\t\tisGenerating3D = true;
\t\tcomingSoonToast = null;
\t\ttry {
\t\t\tconst imageUrl = '/api/paintings/' + encodeURIComponent(painting.id);
\t\t\tconst res = await generate3D(painting.id, imageUrl);
\t\t\tif (res.status === 'mock') {
\t\t\t\tcomingSoonToast = '3D model generation is coming soon!';
\t\t\t}
\t\t} finally {
\t\t\tisGenerating3D = false;
\t\t}
\t}
</script>

{#if painting}
\t<section aria-live="polite" class="fixed right-0 bottom-0 left-0 z-30 mx-auto max-w-lg px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] transition-transform duration-300 ease-out">
\t\t<div class="rounded-3xl border border-white/15 bg-zinc-950/90 p-5 text-white shadow-2xl backdrop-blur-xl">
\t\t\t<div class="mx-auto mb-3 h-1 w-10 rounded-full bg-white/25"></div>
\t\t\t<div class="flex items-start justify-between gap-3">
\t\t\t\t<div>
\t\t\t\t\t<p class="text-xs font-semibold tracking-wider text-sky-400 uppercase">{painting.artist}</p>
\t\t\t\t\t<h2 class="mt-1 text-2xl font-bold leading-tight text-white">{painting.title}</h2>
\t\t\t\t</div>
\t\t\t\t<span class="shrink-0 rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-xs font-medium text-zinc-200">
\t\t\t\t\t{Math.round(painting.confidence * 100)}% match
\t\t\t\t</span>
\t\t\t</div>
\t\t\t{#if comingSoonToast}
\t\t\t\t<div class="mt-3 rounded-xl border border-sky-400/30 bg-sky-500/15 px-3.5 py-2.5 text-xs font-medium text-sky-200">
\t\t\t\t\t{comingSoonToast}
\t\t\t\t</div>
\t\t\t{/if}
\t\t\t<div class="mt-5">
\t\t\t\t<button type="button" disabled={isGenerating3D} onclick={handleGenerate3D} class="flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3.5 text-sm font-semibold text-black shadow-md transition active:scale-[0.98] disabled:opacity-60">
\t\t\t\t\t<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
\t\t\t\t\t\t<path stroke-linecap="round" stroke-linejoin="round" d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
\t\t\t\t\t</svg>
\t\t\t\t\t{isGenerating3D ? 'Preparing 3D preview…' : 'Generate 3D model'}
\t\t\t\t</button>
\t\t\t</div>
\t\t</div>
\t</section>
{/if}
`,

  'src/routes/+page.svelte': `<script lang="ts">
\timport { onDestroy } from 'svelte';
\timport CameraView from '$lib/components/CameraView.svelte';
\timport ResultSheet from '$lib/components/ResultSheet.svelte';
\timport StatusMessage from '$lib/components/StatusMessage.svelte';
\timport { ScannerController } from '$lib/state/scanner.svelte';

\tconst scanner = new ScannerController();
\tlet videoElement = $state<HTMLVideoElement | null>(null);

\tconst isCameraActive = $derived(
\t\tscanner.status === 'scanning' ||
\t\t\tscanner.status === 'recognized' ||
\t\t\tscanner.status === 'backend_unreachable'
\t);

\tfunction handleStart() {
\t\tif (!videoElement) return;
\t\tvoid scanner.start(videoElement);
\t}

\tfunction handleStop() {
\t\tscanner.stop();
\t}

\tfunction onVisibilityChange() {
\t\tvoid scanner.handleVisibilityChange();
\t}

\tonDestroy(() => {
\t\tscanner.stop();
\t});
</script>

<svelte:document onvisibilitychange={onVisibilityChange} />

<main class="relative h-dvh w-screen overflow-hidden bg-black select-none">
\t<CameraView bind:videoRef={videoElement} active={isCameraActive} />
\t<StatusMessage status={scanner.status} errorMessage={scanner.errorMessage} onStart={handleStart} onStop={handleStop} />
\t<ResultSheet painting={scanner.recognized} />
</main>
`,

  'backend/requirements.txt': `fastapi==0.115.5
uvicorn[standard]==0.32.1
python-multipart==0.0.17
pillow==11.0.0
numpy==2.1.3
torch==2.5.1
torchvision==0.20.1
open-clip-torch==2.29.0
pydantic-settings==2.6.1
`,

  'backend/.env.example': `SIMILARITY_THRESHOLD=0.68
SIMILARITY_MARGIN=0.05
CLIP_MODEL_NAME=ViT-B-32
CLIP_PRETRAINED=laion2b_s34b_b79k
DATA_DIR=data
`,

  'backend/data/paintings.json': `[
  {
    "id": "starry-night",
    "title": "The Starry Night",
    "artist": "Vincent van Gogh",
    "image": "starry_night.jpg",
    "images": ["starry_night.jpg"]
  },
  {
    "id": "mona-lisa",
    "title": "Mona Lisa",
    "artist": "Leonardo da Vinci",
    "image": "mona_lisa.jpg"
  },
  {
    "id": "girl-pearl-earring",
    "title": "Girl with a Pearl Earring",
    "artist": "Johannes Vermeer",
    "image": "girl_with_pearl_earring.jpg"
  },
  {
    "id": "the-scream",
    "title": "The Scream",
    "artist": "Edvard Munch",
    "image": "the_scream.jpg"
  },
  {
    "id": "great-wave",
    "title": "The Great Wave off Kanagawa",
    "artist": "Hokusai",
    "image": "great_wave.jpg"
  }
]
`,

  'backend/scripts/build_index.py': `import json
import sys
from pathlib import Path
import numpy as np
import torch
from PIL import Image
import open_clip

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
PAINTINGS_JSON = DATA_DIR / "paintings.json"
IMAGES_DIR = DATA_DIR / "paintings"
INDEX_DIR = DATA_DIR / "index"

MODEL_NAME = "ViT-B-32"
PRETRAINED = "laion2b_s34b_b79k"


def main() -> None:
    if not PAINTINGS_JSON.exists():
        print(f"Error: {PAINTINGS_JSON} not found.")
        sys.exit(1)

    INDEX_DIR.mkdir(parents=True, exist_ok=True)

    with open(PAINTINGS_JSON, "r", encoding="utf-8") as f:
        paintings = json.load(f)

    print(f"Loading CLIP model {MODEL_NAME} ({PRETRAINED})...")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model, _, preprocess = open_clip.create_model_and_transforms(
        MODEL_NAME, pretrained=PRETRAINED, device=device
    )
    model.eval()

    embeddings_list = []
    embedding_painting_ids = []

    for item in paintings:
        painting_id = item["id"]
        img_filenames = item.get("images") or ([item["image"]] if "image" in item else [])

        if not img_filenames:
            print(f"Warning: No images listed for painting '{painting_id}', skipping.")
            continue

        for fname in img_filenames:
            img_path = IMAGES_DIR / fname
            if not img_path.exists():
                print(f"Warning: Image file {img_path} does not exist, skipping.")
                continue

            try:
                img = Image.open(img_path).convert("RGB")
                tensor = preprocess(img).unsqueeze(0).to(device)
                with torch.no_grad():
                    feat = model.encode_image(tensor)
                    feat = feat / feat.norm(dim=-1, keepdim=True)
                embeddings_list.append(feat.cpu().numpy()[0])
                embedding_painting_ids.append(painting_id)
                print(f"Indexed: {painting_id} <- {fname}")
            except Exception as exc:
                print(f"Error processing {img_path}: {exc}")

    if not embeddings_list:
        print("Error: No valid images were indexed. Place images in backend/data/paintings/.")
        sys.exit(1)

    embeddings_matrix = np.vstack(embeddings_list).astype(np.float32)
    np.save(INDEX_DIR / "embeddings.npy", embeddings_matrix)

    meta = {
        "model_name": MODEL_NAME,
        "pretrained": PRETRAINED,
        "embedding_painting_ids": embedding_painting_ids,
        "paintings": {p["id"]: p for p in paintings},
    }
    with open(INDEX_DIR / "index_meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)

    print(f"\\nSuccessfully built index with {len(embeddings_list)} embeddings across {len(paintings)} paintings.")
    print(f"Saved to {INDEX_DIR}")


if __name__ == "__main__":
    main()
`,

  'backend/app/__init__.py': ``,

  'backend/app/config.py': `from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    similarity_threshold: float = 0.68
    similarity_margin: float = 0.05
    clip_model_name: str = "ViT-B-32"
    clip_pretrained: str = "laion2b_s34b_b79k"
    data_dir: Path = BASE_DIR / "data"

    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
`,

  'backend/app/recognizer.py': `import io
import json
import logging
import numpy as np
import torch
from PIL import Image
import open_clip

from .config import settings

logger = logging.getLogger("painting_recognizer")


class PaintingRecognizer:
    def __init__(self) -> None:
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model = None
        self.preprocess = None
        self.embeddings = None
        self.embedding_ids = []
        self.paintings = {}

    def load(self) -> None:
        logger.info(f"Loading CLIP model {settings.clip_model_name} ({settings.clip_pretrained}) on {self.device}...")
        self.model, _, self.preprocess = open_clip.create_model_and_transforms(
            settings.clip_model_name,
            pretrained=settings.clip_pretrained,
            device=self.device,
        )
        self.model.eval()
        self._load_catalog_and_index()

    def _load_catalog_and_index(self) -> None:
        paintings_json = settings.data_dir / "paintings.json"
        if paintings_json.exists():
            with open(paintings_json, "r", encoding="utf-8") as f:
                raw_list = json.load(f)
                self.paintings = {p["id"]: p for p in raw_list}

        index_dir = settings.data_dir / "index"
        emb_path = index_dir / "embeddings.npy"
        meta_path = index_dir / "index_meta.json"

        if emb_path.exists() and meta_path.exists():
            self.embeddings = np.load(emb_path)
            with open(meta_path, "r", encoding="utf-8") as f:
                meta = json.load(f)
                self.embedding_ids = meta["embedding_painting_ids"]
                if "paintings" in meta:
                    self.paintings.update(meta["paintings"])
            logger.info(f"Loaded {len(self.embedding_ids)} embeddings for {len(self.paintings)} paintings.")
        else:
            logger.warning(f"Index files not found in {index_dir}. Run python scripts/build_index.py to generate embeddings.")

    def recognize(self, image_bytes: bytes) -> dict:
        if self.embeddings is None or len(self.embedding_ids) == 0:
            logger.warning("Recognition requested but index is empty.")
            return {
                "match": False,
                "id": None,
                "title": None,
                "artist": None,
                "confidence": 0.0,
            }

        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        tensor = self.preprocess(img).unsqueeze(0).to(self.device)

        with torch.no_grad():
            feat = self.model.encode_image(tensor)
            feat = feat / feat.norm(dim=-1, keepdim=True)
            query_vec = feat.cpu().numpy()[0].astype(np.float32)

        raw_sims = np.dot(self.embeddings, query_vec)

        best_per_painting = {}
        for idx, pid in enumerate(self.embedding_ids):
            score = float(raw_sims[idx])
            if pid not in best_per_painting or score > best_per_painting[pid]:
                best_per_painting[pid] = score

        ranked = sorted(best_per_painting.items(), key=lambda x: x[1], reverse=True)
        best_id, best_score = ranked[0]
        second_id, second_score = ranked[1] if len(ranked) > 1 else ("none", 0.0)
        margin = best_score - second_score

        is_match = (
            best_score >= settings.similarity_threshold
            and margin >= settings.similarity_margin
        )

        logger.info(
            f"Recognize | top='{best_id}' ({best_score:.4f}) | "
            f"second='{second_id}' ({second_score:.4f}) | "
            f"margin={margin:.4f} (req>={settings.similarity_margin}) | "
            f"thresh={settings.similarity_threshold} -> match={is_match}"
        )

        if is_match:
            painting = self.paintings.get(best_id, {})
            return {
                "match": True,
                "id": best_id,
                "title": painting.get("title", "Unknown Title"),
                "artist": painting.get("artist", "Unknown Artist"),
                "confidence": round(best_score, 4),
            }

        return {
            "match": False,
            "id": None,
            "title": None,
            "artist": None,
            "confidence": round(best_score, 4),
        }


recognizer = PaintingRecognizer()
`,

  'backend/app/main.py': `from contextlib import asynccontextmanager
import logging
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import settings
from .recognizer import recognizer

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    recognizer.load()
    yield


app = FastAPI(title="Painting Recognition API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

paintings_dir = settings.data_dir / "paintings"
paintings_dir.mkdir(parents=True, exist_ok=True)
app.mount("/api/images", StaticFiles(directory=paintings_dir), name="images")


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "indexed_embeddings": len(recognizer.embedding_ids),
        "paintings_count": len(recognizer.paintings),
        "threshold": settings.similarity_threshold,
        "margin": settings.similarity_margin,
    }


@app.get("/api/paintings/{painting_id}")
async def get_painting(painting_id: str):
    painting = recognizer.paintings.get(painting_id)
    if not painting:
        raise HTTPException(status_code=404, detail="Painting not found")
    return {
        **painting,
        "imageUrl": "/api/images/" + painting['image'] if "image" in painting else None,
    }


@app.post("/api/recognize")
async def recognize_painting(file: UploadFile = File(...)):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Uploaded file must be an image")
    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Empty image file")

    try:
        result = recognizer.recognize(image_bytes)
        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Inference error: " + str(exc)) from exc
`
};

const emptyDirs = [
  'backend/data/paintings',
  'backend/data/index'
];

for (const dir of emptyDirs) {
  const fullDir = path.resolve(process.cwd(), dir);
  fs.mkdirSync(fullDir, { recursive: true });
}

for (const [relativePath, content] of Object.entries(files)) {
  const fullPath = path.resolve(process.cwd(), relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
  console.log('Created:', relativePath);
}

console.log('\n✅ ArtLens project files generated successfully!');