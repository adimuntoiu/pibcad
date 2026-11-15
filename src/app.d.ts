// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			supabase: import('@supabase/supabase-js').SupabaseClient;
			safeGetSession: () => Promise<{
				session: import('@supabase/supabase-js').Session | null;
				user: import('@supabase/supabase-js').User | null;
			}>;
			session: import('@supabase/supabase-js').Session | null;
			user: import('@supabase/supabase-js').User | null;
		}
		interface PageData {
			session: import('@supabase/supabase-js').Session | null;
			user: import('@supabase/supabase-js').User | null;
		}
		// interface PageState {}
		// interface Platform {}
	}

	const process: {
		env: Record<string, string | undefined>;
	};
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
