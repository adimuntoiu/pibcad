import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const backendDir = path.resolve(rootDir, 'backend');
const venvDir = path.join(backendDir, '.venv');

const isWin = process.platform === 'win32';
const venvPython = isWin
	? path.join(venvDir, 'Scripts', 'python.exe')
	: path.join(venvDir, 'bin', 'python');
const venvPip = isWin
	? path.join(venvDir, 'Scripts', 'pip.exe')
	: path.join(venvDir, 'bin', 'pip');

function findSystemPython() {
	const candidates = isWin
		? ['python', 'py -3', 'python3']
		: ['python3', 'python'];

	for (const cmd of candidates) {
		try {
			const res = spawnSync(cmd.split(' ')[0], cmd.split(' ').slice(1).concat(['--version']), {
				encoding: 'utf-8'
			});
			if (res.status === 0) {
				return cmd;
			}
		} catch {
			// continue
		}
	}
	return null;
}

console.log('[setup-backend] Configuring Python backend environment...');

// 1. Ensure backend/.env exists if root .env exists
const rootEnv = path.join(rootDir, '.env');
const backendEnv = path.join(backendDir, '.env');
if (!fs.existsSync(backendEnv) && fs.existsSync(rootEnv)) {
	try {
		fs.copyFileSync(rootEnv, backendEnv);
		console.log('[setup-backend] Copied root .env to backend/.env');
	} catch (e) {
		console.warn('[setup-backend] Notice: Could not copy .env:', e.message);
	}
}

// 2. Check if venv exists
if (!fs.existsSync(venvPython)) {
	const sysPython = findSystemPython();
	if (!sysPython) {
		console.error('[setup-backend] Error: Python 3 is not installed or not in PATH.');
		console.error('Please install Python 3 (3.10+) to run the recognition backend.');
		process.exit(1);
	}

	console.log(`[setup-backend] Creating virtualenv at backend/.venv using ${sysPython}...`);
	const [bin, ...args] = sysPython.split(' ');
	const venvRes = spawnSync(bin, [...args, '-m', 'venv', venvDir], {
		cwd: backendDir,
		stdio: 'inherit'
	});
	if (venvRes.status !== 0) {
		console.error('[setup-backend] Failed to create virtualenv.');
		process.exit(1);
	}
}

// 3. Install requirements
const reqFile = path.join(backendDir, 'requirements.txt');
if (fs.existsSync(reqFile) && fs.existsSync(venvPip)) {
	console.log('[setup-backend] Installing backend dependencies from requirements.txt...');
	const pipRes = spawnSync(venvPip, ['install', '-r', reqFile], {
		cwd: backendDir,
		stdio: 'inherit'
	});
	if (pipRes.status !== 0) {
		console.warn('[setup-backend] Notice: pip install returned non-zero code.');
	} else {
		console.log('[setup-backend] Python backend dependencies installed successfully!');
	}
}

console.log('[setup-backend] Backend environment is ready.');
