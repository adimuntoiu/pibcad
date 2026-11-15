import { compileTargetFromPixels } from './targetCompilerCore';

export interface WorkerCompileRequest {
	type: 'compile';
	rgbaBuffer: ArrayBuffer;
	width: number;
	height: number;
}

export interface WorkerProgressMessage {
	type: 'progress';
	progress: number;
	stage: string;
}

export interface WorkerCompleteMessage {
	type: 'complete';
	metrics: ReturnType<typeof compileTargetFromPixels>['metrics'];
	targetBuffer: ArrayBuffer;
	width: number;
	height: number;
	scaleKeypoints: number[];
}

export interface WorkerErrorMessage {
	type: 'error';
	message: string;
}

export type WorkerResponseMessage =
	| WorkerProgressMessage
	| WorkerCompleteMessage
	| WorkerErrorMessage;

self.onmessage = (event: MessageEvent<WorkerCompileRequest>) => {
	const data = event.data;
	if (!data || data.type !== 'compile') return;

	try {
		const rgba = new Uint8ClampedArray(data.rgbaBuffer);
		const result = compileTargetFromPixels(rgba, data.width, data.height, (progress, stage) => {
			const msg: WorkerProgressMessage = { type: 'progress', progress, stage };
			self.postMessage(msg);
		});

		const buffer = result.targetBuffer.buffer.slice(
			result.targetBuffer.byteOffset,
			result.targetBuffer.byteOffset + result.targetBuffer.byteLength
		) as ArrayBuffer;

		const completeMsg: WorkerCompleteMessage = {
			type: 'complete',
			metrics: result.metrics,
			targetBuffer: buffer,
			width: result.width,
			height: result.height,
			scaleKeypoints: result.scaleKeypoints
		};

		self.postMessage(completeMsg, { transfer: [buffer] });
	} catch (err) {
		const errMsg: WorkerErrorMessage = {
			type: 'error',
			message: err instanceof Error ? err.message : 'Target compilation worker error'
		};
		self.postMessage(errMsg);
	}
};
