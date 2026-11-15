<script lang="ts">
	import BrandBackground from '#lib/components/BrandBackground.svelte';
	import Logo from '#lib/components/Logo.svelte';
	import PillButton from '#lib/components/PillButton.svelte';
	import PillInput from '#lib/components/PillInput.svelte';
	import { getSupabaseBrowserClient } from '#lib/supabase/client';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';

	let mode = $state<'login' | 'signup'>('login');
	let email = $state('');
	let password = $state('');
	let displayName = $state('');

	let loading = $state(false);
	let errorMessage = $state<string | null>(null);
	let successMessage = $state<string | null>(null);

	const supabase = getSupabaseBrowserClient();

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		loading = true;
		errorMessage = null;
		successMessage = null;

		const redirectTo = page.url.searchParams.get('redirectTo') || '/artist';

		try {
			// Check if using placeholder credentials
			const isPlaceholder = !import.meta.env.PUBLIC_SUPABASE_URL || import.meta.env.PUBLIC_SUPABASE_URL.includes('placeholder');

			if (mode === 'login') {
				if (isPlaceholder) {
					// Local mock session for testing before Supabase keys are configured
					const mockUser = {
						id: 'demo-artist-uuid',
						email,
						user_metadata: { display_name: email.split('@')[0].toUpperCase(), username: email.split('@')[0] }
					};
					document.cookie = `artizart_demo_session=${JSON.stringify({ user: mockUser, session: { access_token: 'mock-token' } })}; path=/; max-age=86400`;
					await goto(redirectTo, { invalidateAll: true });
					return;
				}

				const { error } = await supabase.auth.signInWithPassword({
					email,
					password
				});

				if (error) {
					if (error.message.includes('Invalid login credentials')) {
						errorMessage = 'Invalid email or password. Please try again.';
					} else if (error.message.includes('Email not confirmed')) {
						errorMessage = 'Email not confirmed. Please check your inbox.';
					} else {
						errorMessage = error.message;
					}
					return;
				}

				await goto(redirectTo, { invalidateAll: true });
			} else {
				// Sign up mode
				if (isPlaceholder) {
					const mockUser = {
						id: 'demo-artist-uuid',
						email,
						user_metadata: { display_name: displayName || email.split('@')[0].toUpperCase(), username: email.split('@')[0] }
					};
					document.cookie = `artizart_demo_session=${JSON.stringify({ user: mockUser, session: { access_token: 'mock-token' } })}; path=/; max-age=86400`;
					await goto(redirectTo, { invalidateAll: true });
					return;
				}

				const { data, error } = await supabase.auth.signUp({
					email,
					password,
					options: {
						data: {
							display_name: displayName || email.split('@')[0],
							username: email.split('@')[0]
						}
					}
				});

				if (error) {
					errorMessage = error.message;
					return;
				}

				if (data.session) {
					await goto(redirectTo, { invalidateAll: true });
				} else {
					successMessage = 'Account created! Please check your email to confirm.';
					mode = 'login';
				}
			}
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Network error. Please try again.';
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>{mode === 'login' ? 'Artist Login' : 'Create Account'} — artizART</title>
</svelte:head>

<BrandBackground>
	<div class="flex flex-1 flex-col items-center justify-between py-6">
		<!-- Header / Logo -->
		<header class="flex w-full items-center justify-between pt-1">
			<a
				href="/"
				class="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-md transition-opacity hover:opacity-80"
				aria-label="Back to Camera"
			>
				<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 19l-7-7 7-7" />
				</svg>
			</a>

			<div class="flex-1 text-center pr-10">
				<Logo accent="light" size="md" />
			</div>
		</header>

		<!-- Main Login / Sign Up Form (Mockup 4) -->
		<main class="flex w-full max-w-xs flex-col items-center text-center">
			<p class="font-sans text-xl font-normal text-white sm:text-2xl">
				For artists
			</p>
			<h1 class="font-display text-5xl font-bold uppercase tracking-tight text-white sm:text-6xl">
				{mode === 'login' ? 'LOGIN' : 'SIGN UP'}
			</h1>

			{#if errorMessage}
				<div class="mt-4 w-full rounded-2xl border border-rose-500/30 bg-rose-500/20 px-4 py-2.5 text-xs font-semibold text-rose-200">
					{errorMessage}
				</div>
			{/if}

			{#if successMessage}
				<div class="mt-4 w-full rounded-2xl border border-emerald-400/30 bg-emerald-500/20 px-4 py-2.5 text-xs font-semibold text-emerald-200">
					{successMessage}
				</div>
			{/if}

			<form onsubmit={handleSubmit} class="mt-6 flex w-full flex-col items-center gap-4">
				{#if mode === 'signup'}
					<PillInput
						type="text"
						name="displayName"
						placeholder="DISPLAY NAME"
						bind:value={displayName}
						required
					/>
				{/if}

				<!-- Changed from USERNAME to EMAIL to match Supabase Auth requirement while retaining Mockup 4 pill styling -->
				<PillInput
					type="email"
					name="email"
					placeholder="EMAIL"
					bind:value={email}
					required
				/>

				<PillInput
					type="password"
					name="password"
					placeholder="PASSWORD"
					bind:value={password}
					required
				/>

				<div class="mt-4 flex w-full flex-col items-center gap-3.5">
					<PillButton type="submit" variant="white" disabled={loading} class="w-44">
						{loading ? 'PLEASE WAIT…' : mode === 'login' ? 'LOGIN' : 'CREATE ACCOUNT'}
					</PillButton>

					{#if mode === 'login'}
						<PillButton
							type="button"
							variant="white"
							onclick={() => {
								mode = 'signup';
								errorMessage = null;
							}}
							class="w-64"
						>
							CREATE ACCOUNT
						</PillButton>
					{:else}
						<PillButton
							type="button"
							variant="white"
							onclick={() => {
								mode = 'login';
								errorMessage = null;
							}}
							class="w-44"
						>
							BACK TO LOGIN
						</PillButton>
					{/if}
				</div>
			</form>
		</main>

		<!-- Bottom Spacer / Subtle Back Link -->
		<footer class="pt-6">
			<a
				href="/"
				class="font-sans text-xs font-semibold tracking-wider text-purple-200/60 uppercase transition-colors hover:text-white"
			>
				← Back to Scanner
			</a>
		</footer>
	</div>
</BrandBackground>
