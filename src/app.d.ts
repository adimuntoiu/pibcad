// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

declare module 'node:child_process' {
	export interface StdioStream {
		on(event: 'data', listener: (chunk: Uint8Array) => void): void;
		off(event: 'data', listener: (chunk: Uint8Array) => void): void;
		write(data: Uint8Array): boolean;
	}
	export interface ChildProcessHandle {
		readonly killed: boolean;
		readonly stdin: StdioStream;
		readonly stdout: StdioStream;
		on(event: 'exit', listener: () => void): void;
		once(event: 'error', listener: (err: Error) => void): void;
		off(event: 'error', listener: (err: Error) => void): void;
	}
	export function spawn(
		command: string,
		args: string[],
		options?: { cwd?: string; stdio?: ['pipe', 'pipe', 'inherit'] }
	): ChildProcessHandle;
}

declare module 'node:path' {
	const path: {
		resolve(...segments: string[]): string;
	};
	export default path;
}

export {};
