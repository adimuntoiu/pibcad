import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const staticDir = path.join(rootDir, 'static');
const manifestPath = path.join(staticDir, 'demo', 'manifest.json');
const outPath = path.join(staticDir, 'demo', 'targets', 'compiled-targets.json');

if (!fs.existsSync(manifestPath)) {
	console.error(`Manifest not found at ${manifestPath}`);
	process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
const targets = [];

for (const canvas of manifest.canvases) {
	const relUrl = canvas.imageTargetUrl.replace(/^\//, '');
	const imgPath = path.join(staticDir, relUrl);
	const exists = fs.existsSync(imgPath);
	const bytes = exists ? fs.statSync(imgPath).size : 0;

	const ring = [canvas.edges.top, canvas.edges.right, canvas.edges.bottom, canvas.edges.left];
	const rotations = [0, 90, 180, 270].map((deg, step) => {
		const shifted = [0, 1, 2, 3].map((i) => ring[(i - step + 4) % 4]);
		return {
			targetKey: `${canvas.id}_rot${deg}`,
			rotationDeg: deg,
			edges: {
				top: shifted[0],
				right: shifted[1],
				bottom: shifted[2],
				left: shifted[3]
			}
		};
	});

	targets.push({
		id: canvas.id,
		name: canvas.name,
		aliases: canvas.aliases ?? [],
		imageTargetUrl: canvas.imageTargetUrl,
		verified: exists,
		fileSizeBytes: bytes,
		rotations
	});
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(
	outPath,
	JSON.stringify(
		{
			compiledAt: new Date().toISOString(),
			engine: 'asift-rootsift-homography-v1',
			rotationStepsDeg: [0, 90, 180, 270],
			targets
		},
		null,
		2
	) + '\n'
);

console.log(`Compiled ${targets.length} canvas target packs (4 rotations each) -> ${outPath}`);
