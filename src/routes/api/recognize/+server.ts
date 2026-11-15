import { json, type RequestHandler } from '@sveltejs/kit';

interface StdioStream {
	on(event: 'data', listener: (chunk: Uint8Array) => void): void;
	off(event: 'data', listener: (chunk: Uint8Array) => void): void;
	write(data: Uint8Array): boolean;
}

interface ChildProcessHandle {
	readonly killed: boolean;
	readonly stdin: StdioStream;
	readonly stdout: StdioStream;
	on(event: 'exit', listener: () => void): void;
	once(event: 'error', listener: (err: Error) => void): void;
	off(event: 'error', listener: (err: Error) => void): void;
}

// Warm Python OpenCV bridge (v5: loads paintings from Supabase when configured in backend/.env,
// falls back to local files; hot-reloads when recognizer.py, config.py, .env or paintings.json change)
const WORKER_SCRIPT = `
import sys, os, struct, json, importlib
sys.path.insert(0, 'backend')
import app.config as cfg_mod
import app.recognizer as rec_mod
rec_mod.detector.load()
WATCHED = ['backend/app/recognizer.py', 'backend/app/config.py', 'backend/.env', 'backend/data/paintings.json']
def get_sig():
    return tuple(os.path.getmtime(p) if os.path.exists(p) else 0.0 for p in WATCHED)
last_sig = get_sig()
sys.stdout.buffer.write(b'READY\\n')
sys.stdout.buffer.flush()

while True:
    hdr = sys.stdin.buffer.read(4)
    if not hdr or len(hdr) < 4:
        break
    length = struct.unpack('>I', hdr)[0]
    data = b''
    while len(data) < length:
        chunk = sys.stdin.buffer.read(length - len(data))
        if not chunk:
            break
        data += chunk
    try:
        sig = get_sig()
        if sig != last_sig:
            last_sig = sig
            cfg_mod = importlib.reload(cfg_mod)
            rec_mod = importlib.reload(rec_mod)
            rec_mod.detector.load()
    except Exception as e:
        sys.stderr.write('detector reload failed: %r\\n' % (e,))
    res = rec_mod.detector.detect(data)
    out = json.dumps(res).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('>I', len(out)) + out)
    sys.stdout.buffer.flush()
`;

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
	const out = new Uint8Array(a.byteLength + b.byteLength);
	out.set(a, 0);
	out.set(b, a.byteLength);
	return out;
}

class PythonDetectorBridge {
	private proc: ChildProcessHandle | null = null;
	private readyPromise: Promise<void> | null = null;
	private queue: Promise<unknown> = Promise.resolve();
	private readonly decoder = new TextDecoder();

	private async resolvePythonBin(): Promise<string> {
		const fsName = 'fs';
		const pathName = 'path';
		const fsMod = (await import(/* @vite-ignore */ fsName)) as unknown as {
			existsSync: (p: string) => boolean;
		};
		const pathMod = (await import(/* @vite-ignore */ pathName)) as unknown as {
			resolve: (...segments: string[]) => string;
		};

		const procEnv = (globalThis as unknown as { process?: { env?: Record<string, string | undefined>; platform?: string } }).process;
		if (procEnv?.env?.PYTHON_BIN && fsMod.existsSync(procEnv.env.PYTHON_BIN)) {
			return procEnv.env.PYTHON_BIN;
		}

		const isWin = procEnv?.platform === 'win32';
		const candidates = [
			pathMod.resolve(isWin ? 'backend/.venv/Scripts/python.exe' : 'backend/.venv/bin/python'),
			pathMod.resolve(isWin ? '.venv/Scripts/python.exe' : '.venv/bin/python')
		];

		for (const candidate of candidates) {
			if (fsMod.existsSync(candidate)) {
				return candidate;
			}
		}

		return isWin ? 'python' : 'python3';
	}

	private async ensureStarted(): Promise<void> {
		if (this.proc && !this.proc.killed && this.readyPromise) {
			return this.readyPromise;
		}

		const cpModName = 'child_process';
		const cp = (await import(/* @vite-ignore */ cpModName)) as {
			spawn: (
				cmd: string,
				args: string[],
				opts: { stdio: ['pipe', 'pipe', 'inherit'] }
			) => ChildProcessHandle;
		};

		const pythonBin = await this.resolvePythonBin();
		const proc = cp.spawn(pythonBin, ['-u', '-c', WORKER_SCRIPT], {
			stdio: ['pipe', 'pipe', 'inherit']
		});
		this.proc = proc;

		proc.on('exit', () => {
			if (this.proc === proc) {
				this.proc = null;
				this.readyPromise = null;
			}
		});

		this.readyPromise = new Promise<void>((resolve, reject) => {
			const onData = (chunk: Uint8Array) => {
				if (this.decoder.decode(chunk).includes('READY')) {
					proc.stdout.off('data', onData);
					resolve();
				}
			};
			proc.stdout.on('data', onData);
			proc.once('error', reject);
		});

		return this.readyPromise;
	}

	detect(imageBytes: Uint8Array): Promise<Record<string, unknown>> {
		const task = this.queue.then(async () => {
			await this.ensureStarted();
			const proc = this.proc!;

			return new Promise<Record<string, unknown>>((resolve, reject) => {
				let expectedLen: number | null = null;
				let acc: Uint8Array = new Uint8Array(0);

				const cleanup = () => {
					proc.stdout.off('data', onData);
					proc.off('error', onError);
				};

				const onError = (err: Error) => {
					cleanup();
					reject(err);
				};

				const onData = (chunk: Uint8Array) => {
					acc = concatBytes(acc, chunk);
					if (expectedLen === null && acc.byteLength >= 4) {
						const view = new DataView(acc.buffer, acc.byteOffset, acc.byteLength);
						expectedLen = view.getUint32(0, false);
						acc = acc.slice(4);
					}
					if (expectedLen !== null && acc.byteLength >= expectedLen) {
						const payload = this.decoder.decode(acc.subarray(0, expectedLen));
						cleanup();
						try {
							resolve(JSON.parse(payload) as Record<string, unknown>);
						} catch (e) {
							reject(e);
						}
					}
				};

				proc.stdout.on('data', onData);
				proc.once('error', onError);

				const header = new Uint8Array(4);
				new DataView(header.buffer).setUint32(0, imageBytes.byteLength, false);
				proc.stdin.write(concatBytes(header, imageBytes));
			});
		});

		this.queue = task.catch(() => {});
		return task;
	}
}

const bridge = new PythonDetectorBridge();

export const POST: RequestHandler = async ({ request }) => {
	const formData = await request.formData();
	const file = formData.get('file');
	if (!(file instanceof Blob)) {
		return json({ error: 'Uploaded file must be an image' }, { status: 400 });
	}

	// 1. Try remote backend service (BACKEND_URL) or local Uvicorn HTTP server (port 8000)
	const backendUrl = process.env.BACKEND_URL;
	const candidateUrls = backendUrl
		? [backendUrl]
		: ['http://127.0.0.1:8000', 'http://localhost:8000'];

	for (const candidate of candidateUrls) {
		try {
			const targetUrl = new URL('/api/recognize', candidate);
			const forwardData = new FormData();
			forwardData.append('file', file);
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 12000);
			const res = await fetch(targetUrl, {
				method: 'POST',
				body: forwardData,
				signal: controller.signal
			});
			clearTimeout(timeout);
			if (res.ok) {
				const result = await res.json();
				return json(result, { status: res.status });
			} else {
				const errText = await res.text();
				console.error(`[api/recognize] Backend at ${candidate} returned ${res.status}:`, errText);
				return json(
					{
						match: false,
						error: `Backend error (${res.status})`,
						details: errText
					},
					{ status: res.status }
				);
			}
		} catch {
			// Backend not running on this URL; try next candidate or fall back to child process
		}
	}

	// 2. Local development fallback: in-process Python child bridge
	const bytes = new Uint8Array(await file.arrayBuffer());
	if (bytes.byteLength === 0) {
		return json({ error: 'Empty image file' }, { status: 400 });
	}

	try {
		const result = await bridge.detect(bytes);
		return json(result);
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error('[api/recognize] In-process Python bridge failed:', msg);
		return json(
			{
				match: false,
				error: 'Recognition backend is offline or unconfigured.',
				hint: 'Run "npm run setup:backend" or start FastAPI backend ("npm run dev:backend").',
				details: msg
			},
			{ status: 503 }
		);
	}
};
