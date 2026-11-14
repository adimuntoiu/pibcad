import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const backendDir = path.resolve(process.cwd(), 'backend');
const venvPython =
	process.platform === 'win32'
		? path.join(backendDir, '.venv', 'Scripts', 'python.exe')
		: path.join(backendDir, '.venv', 'bin', 'python');

const pythonBin = fs.existsSync(venvPython) ? venvPython : 'python3';

const args = [
	'-m',
	'uvicorn',
	'app.main:app',
	'--host',
	'0.0.0.0',
	'--port',
	process.env.BACKEND_PORT || '8000',
	'--reload'
];

const child = spawn(pythonBin, args, {
	cwd: backendDir,
	stdio: 'inherit'
});

function shutdown(signal) {
	if (!child.killed) {
		child.kill(signal);
	}
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

child.on('exit', (code) => {
	process.exit(code ?? 0);
});
