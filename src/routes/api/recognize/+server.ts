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

// Warm Python OpenCV bridge (v4: 4 paintings indexed, auto-reloads on recognizer.py or paintings.json change)
const WORKER_SCRIPT = `
import sys, os, struct, json, importlib
sys.path.insert(0, 'backend')
import app.recognizer as rec_mod
rec_mod.detector.load()
def get_sig():
    return (os.path.getmtime('backend/app/recognizer.py'), os.path.getmtime('backend/data/paintings.json'))
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
            rec_mod = importlib.reload(rec_mod)
            rec_mod.detector.load()
    except Exception:
        pass
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

		const proc = cp.spawn('backend/.venv/bin/python', ['-u', '-c', WORKER_SCRIPT], {
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
	const bytes = new Uint8Array(await file.arrayBuffer());
	if (bytes.byteLength === 0) {
		return json({ error: 'Empty image file' }, { status: 400 });
	}

	const result = await bridge.detect(bytes);
	return json(result);
};
