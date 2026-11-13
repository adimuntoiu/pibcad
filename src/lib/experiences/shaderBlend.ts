import * as THREE from 'three';
import type { RotationDeg, ShaderBlendParams } from '#lib/types';

const VERTEX_SHADER = /* glsl */ `
	uniform float uTime;
	uniform float uSpeed;
	uniform float uIntensity;
	uniform float uWaveFrequency;
	uniform float uOpacity;

	varying vec2 vUv;
	varying float vSeamMask;

	void main() {
		vUv = uv;

		// Gaussian mask centered at the vertical seam (uv.x = 0.5)
		float distFromSeam = abs(uv.x - 0.5);
		vSeamMask = exp(-pow(distFromSeam * 3.6, 2.0));

		// Subtle 3D vertex wave ripple strongest along the seam
		vec3 pos = position;
		float wave = sin(uv.y * uWaveFrequency * 6.28318 + uTime * uSpeed * 2.2)
		           * cos(uv.x * uWaveFrequency * 3.14159 - uTime * uSpeed * 1.6);
		pos.z += wave * 0.045 * uIntensity * vSeamMask;

		gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
	}
`;

const FRAGMENT_SHADER = /* glsl */ `
	precision highp float;

	uniform sampler2D uTexLeft;
	uniform sampler2D uTexRight;
	uniform float uRotLeftRad;
	uniform float uRotRightRad;
	uniform float uTime;
	uniform float uSpeed;
	uniform float uIntensity;
	uniform float uWaveFrequency;
	uniform float uSeamWidth;
	uniform vec3 uAccentColor;
	uniform float uOpacity;

	varying vec2 vUv;
	varying float vSeamMask;

	vec2 rotateUV(vec2 uv, float angleRad) {
		vec2 centered = uv - 0.5;
		float c = cos(angleRad);
		float s = sin(angleRad);
		mat2 rot = mat2(c, -s, s, c);
		return clamp(rot * centered + 0.5, 0.01, 0.99);
	}

	// Simplex-like 2D harmonic curl field for organic fluid distortion
	vec2 fluidOffset(vec2 p, float t) {
		float a = sin(p.y * 9.0 + t * 1.7) + cos(p.x * 7.0 - t * 1.3);
		float b = cos(p.x * 8.5 + t * 1.4) - sin(p.y * 6.5 + t * 1.9);
		return vec2(a, b) * 0.035;
	}

	void main() {
		float t = uTime * uSpeed;
		float distFromSeam = abs(vUv.x - 0.5);

		// Map the 2x1 bridge plane back to Left (0..0.5) and Right (0.5..1.0) square canvas UVs
		vec2 localUvLeft = vec2(clamp(vUv.x * 2.0, 0.0, 1.0), vUv.y);
		vec2 localUvRight = vec2(clamp((vUv.x - 0.5) * 2.0, 0.0, 1.0), vUv.y);

		// Fluid displacement strongest across the seam bridge
		float seamInfluence = smoothstep(uSeamWidth, 0.0, distFromSeam);
		vec2 flow = fluidOffset(vUv * uWaveFrequency, t) * uIntensity * (0.35 + 0.65 * seamInfluence);

		// Cross-sample both canvases with fluid advection so colors bleed across the seam
		vec2 sampleLeftUv = rotateUV(localUvLeft + flow, uRotLeftRad);
		vec2 sampleRightUv = rotateUV(localUvRight - flow, uRotRightRad);

		// Also sample mirrored seam region so Left texture flows into Right and vice versa
		vec2 crossLeftUv = rotateUV(vec2(1.0 - abs(vUv.x - 0.5) * 1.6, vUv.y) + flow * 1.4, uRotLeftRad);
		vec2 crossRightUv = rotateUV(vec2(abs(vUv.x - 0.5) * 1.6, vUv.y) - flow * 1.4, uRotRightRad);

		vec4 colLeft = texture2D(uTexLeft, sampleLeftUv);
		vec4 colRight = texture2D(uTexRight, sampleRightUv);
		vec4 bleedLeft = texture2D(uTexLeft, crossLeftUv);
		vec4 bleedRight = texture2D(uTexRight, crossRightUv);

		// Perturb the seam mixing boundary with animated sine waves
		float waveShift = sin(vUv.y * uWaveFrequency * 6.28318 + t * 2.0) * 0.06 * uIntensity
		                + cos(vUv.y * 14.0 - t * 3.1) * 0.025 * uIntensity;
		float blendFactor = smoothstep(0.5 - uSeamWidth * 0.65, 0.5 + uSeamWidth * 0.65, vUv.x + waveShift);

		vec3 baseLeft = mix(colLeft.rgb, bleedRight.rgb, seamInfluence * 0.55 * uIntensity);
		vec3 baseRight = mix(colRight.rgb, bleedLeft.rgb, seamInfluence * 0.55 * uIntensity);
		vec3 blended = mix(baseLeft, baseRight, blendFactor);

		// Luminous energy filaments weaving across the seam
		float filament1 = abs(vUv.x - 0.5 + sin(vUv.y * 10.0 + t * 2.6) * 0.075 * uIntensity);
		float filament2 = abs(vUv.x - 0.5 - cos(vUv.y * 7.5 - t * 2.1) * 0.06 * uIntensity);
		float glow = (0.008 / (filament1 + 0.006) + 0.006 / (filament2 + 0.008)) * seamInfluence * uIntensity;

		vec3 finalColor = blended + uAccentColor * clamp(glow, 0.0, 1.35);

		// Soft vignette along outer border so overlay blends naturally with physical canvas edges
		float edgeFadeX = smoothstep(0.0, 0.04, vUv.x) * smoothstep(1.0, 0.96, vUv.x);
		float edgeFadeY = smoothstep(0.0, 0.04, vUv.y) * smoothstep(1.0, 0.96, vUv.y);
		float alpha = edgeFadeX * edgeFadeY * uOpacity;

		gl_FragColor = vec4(finalColor, alpha);
	}
`;

export class ShaderBlendSurface {
	readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
	private readonly material: THREE.ShaderMaterial;
	private readonly textureLoader = new THREE.TextureLoader();
	private loadedLeftUrl: string | null = null;
	private loadedRightUrl: string | null = null;

	constructor() {
		const geometry = new THREE.PlaneGeometry(2.0, 1.0, 64, 32);
		this.material = new THREE.ShaderMaterial({
			vertexShader: VERTEX_SHADER,
			fragmentShader: FRAGMENT_SHADER,
			transparent: true,
			depthWrite: false,
			side: THREE.DoubleSide,
			uniforms: {
				uTexLeft: { value: this.createFallbackTexture('#f59e0b') },
				uTexRight: { value: this.createFallbackTexture('#0284c7') },
				uRotLeftRad: { value: 0 },
				uRotRightRad: { value: 0 },
				uTime: { value: 0 },
				uSpeed: { value: 1.2 },
				uIntensity: { value: 0.85 },
				uWaveFrequency: { value: 3.5 },
				uSeamWidth: { value: 0.38 },
				uAccentColor: { value: new THREE.Vector3(0.22, 0.92, 0.74) },
				uOpacity: { value: 0 }
			}
		});

		this.mesh = new THREE.Mesh(geometry, this.material);
		this.mesh.visible = false;
	}

	private createFallbackTexture(hexColor: string): THREE.DataTexture {
		const color = new THREE.Color(hexColor);
		const data = new Uint8Array([
			Math.round(color.r * 255),
			Math.round(color.g * 255),
			Math.round(color.b * 255),
			255
		]);
		const tex = new THREE.DataTexture(data, 1, 1);
		tex.needsUpdate = true;
		return tex;
	}

	setTextures(leftUrl: string, rightUrl: string): void {
		if (this.loadedLeftUrl !== leftUrl) {
			this.loadedLeftUrl = leftUrl;
			this.textureLoader.load(leftUrl, (tex) => {
				tex.colorSpace = THREE.SRGBColorSpace;
				tex.minFilter = THREE.LinearFilter;
				tex.magFilter = THREE.LinearFilter;
				this.material.uniforms.uTexLeft.value = tex;
			});
		}

		if (this.loadedRightUrl !== rightUrl) {
			this.loadedRightUrl = rightUrl;
			this.textureLoader.load(rightUrl, (tex) => {
				tex.colorSpace = THREE.SRGBColorSpace;
				tex.minFilter = THREE.LinearFilter;
				tex.magFilter = THREE.LinearFilter;
				this.material.uniforms.uTexRight.value = tex;
			});
		}
	}

	setRotations(rotLeft: RotationDeg, rotRight: RotationDeg): void {
		// Convert clockwise degrees to UV rotation radians
		this.material.uniforms.uRotLeftRad.value = (rotLeft * Math.PI) / 180;
		this.material.uniforms.uRotRightRad.value = (rotRight * Math.PI) / 180;
	}

	setParams(params: ShaderBlendParams): void {
		this.material.uniforms.uSpeed.value = params.speed ?? 1.2;
		this.material.uniforms.uIntensity.value = params.intensity ?? 0.85;
		this.material.uniforms.uWaveFrequency.value = params.waveFrequency ?? 3.5;
		this.material.uniforms.uSeamWidth.value = params.seamWidth ?? 0.38;
		if (params.accentColor) {
			this.material.uniforms.uAccentColor.value.set(
				params.accentColor[0],
				params.accentColor[1],
				params.accentColor[2]
			);
		}
	}

	update(elapsedSeconds: number, opacity: number): void {
		this.material.uniforms.uTime.value = elapsedSeconds;
		this.material.uniforms.uOpacity.value = opacity;
		this.mesh.visible = opacity > 0.005;
	}

	dispose(): void {
		this.mesh.geometry.dispose();
		this.material.dispose();
	}
}
