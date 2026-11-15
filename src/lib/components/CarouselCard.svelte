<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		children?: Snippet;
		class?: string;
	}

	let { children, class: className = '' }: Props = $props();
</script>

<div
	class="relative flex aspect-square w-full max-w-sm flex-col items-center justify-center overflow-hidden rounded-[2.25rem] bg-[#D9D9D9] p-4 shadow-lg transition-transform hover:scale-[1.01] {className}"
>
	{@render children?.()}
</div>
