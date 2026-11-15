<script lang="ts">
	import BrandBackground from '#lib/components/BrandBackground.svelte';
	import Logo from '#lib/components/Logo.svelte';
	import PillButton from '#lib/components/PillButton.svelte';
	import PillInput from '#lib/components/PillInput.svelte';

	let username = $state('');
	let password = $state('');

	function handleLogin(e: SubmitEvent) {
		e.preventDefault();
		// Static screen demo: navigate to artist dashboard
		window.location.href = '/artist';
	}
</script>

<svelte:head>
	<title>Artist Login — artizART</title>
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

		<!-- Main Login Form -->
		<main class="flex w-full max-w-xs flex-col items-center text-center">
			<p class="font-sans text-xl font-normal text-white sm:text-2xl">
				For artists
			</p>
			<h1 class="font-display text-5xl font-bold uppercase tracking-tight text-white sm:text-6xl">
				LOGIN
			</h1>

			<form onsubmit={handleLogin} class="mt-8 flex w-full flex-col items-center gap-4">
				<PillInput
					type="text"
					name="username"
					placeholder="USERNAME"
					bind:value={username}
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
					<PillButton type="submit" variant="white" class="w-36">
						LOGIN
					</PillButton>
					<PillButton type="button" variant="white" class="w-64">
						CREATE ACCOUNT
					</PillButton>
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
