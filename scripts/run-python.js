import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const backendDir = path.resolve(process.cwd(), 'backend');
const isWin = process.platform === 'win32';
const venvPython = isWin
	? path.join(backendDir, '.venv', 'Scripts', 'python.exe')
	: path.join(backendDir, '.venv', 'bin', 'python');

const pythonBin = fs.existsSync(venvPython)
	? venvPython
	: (isWin ? 'python' : 'python3');

const scriptArgs = process.argv.slice(2);
const res = spawnSync(pythonBin, scriptArgs, {
	stdio: 'inherit'
});
process.exit(res.status ?? 0);
