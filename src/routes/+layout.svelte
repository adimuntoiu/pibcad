<script lang="ts">
	import '../app.css';
	import favicon from '#lib/assets/favicon.svg';
	import type { LayoutProps } from './$types';
	import { page } from '$app/state';
	import { onNavigate, invalidate } from '$app/navigation';
	import { onMount } from 'svelte';

	let { data, children }: LayoutProps = $props();

	onMount(() => {
		if (data?.supabase?.auth) {
			const { data: authData } = data.supabase.auth.onAuthStateChange((event, newSession) => {
				if (newSession?.expires_at !== data.session?.expires_at) {
					invalidate('supabase:auth');
				}
			});

			return () => {
				authData.subscription.unsubscribe();
			};
		}
	});

	onNavigate((navigation) => {
		if (!document.startViewTransition) return;

		return new Promise((resolve) => {
			document.startViewTransition(async () => {
				resolve();
				await navigation.complete;
			});
		});
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="relative min-h-dvh w-full bg-brand-purple">
	{#key page.url.pathname}
		<div class="page-transition-frame">
			{@render children()}
		</div>
	{/key}
</div>
