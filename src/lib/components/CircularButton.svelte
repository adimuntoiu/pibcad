<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		ariaLabel: string;
		onclick?: (e: MouseEvent) => void;
		href?: string;
		size?: 'sm' | 'md' | 'lg';
		children?: Snippet;
		class?: string;
	}

	let {
		ariaLabel,
		onclick,
		href,
		size = 'md',
		children,
		class: className = ''
	}: Props = $props();

	const sizeClasses = {
		sm: 'h-10 w-10 text-base',
		md: 'h-12 w-12 text-lg',
		lg: 'h-14 w-14 text-xl'
	};
</script>

{#if href}
	<a
		{href}
		aria-label={ariaLabel}
		class="inline-flex items-center justify-center rounded-full bg-[#D9D9D9] text-zinc-900 shadow-md transition-transform active:scale-95 hover:bg-[#E5E7EB] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white {sizeClasses[size]} {className}"
	>
		{@render children?.()}
	</a>
{:else}
	<button
		type="button"
		aria-label={ariaLabel}
		{onclick}
		class="inline-flex items-center justify-center rounded-full bg-[#D9D9D9] text-zinc-900 shadow-md transition-transform active:scale-95 hover:bg-[#E5E7EB] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white {sizeClasses[size]} {className}"
	>
		{@render children?.()}
	</button>
{/if}
