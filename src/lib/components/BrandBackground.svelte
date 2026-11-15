<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		children?: Snippet;
		class?: string;
	}

	let { children, class: className = '' }: Props = $props();
</script>

<div
	class="relative flex min-h-[100dvh] w-full flex-col overflow-x-hidden bg-[#511A9A] bg-cover bg-center bg-no-repeat {className}"
	style="background-image: linear-gradient(180deg, #5A1CA7 0%, #441484 100%), url('/brand/purple-waves.webp'); background-blend-mode: overlay;"
>
	<!-- Safe Area Container -->
	<div
		class="relative flex flex-1 flex-col px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))]"
	>
		{@render children?.()}
	</div>
</div>
