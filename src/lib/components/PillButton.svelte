<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		type?: 'button' | 'submit' | 'reset';
		variant?: 'white' | 'grey' | 'purple';
		size?: 'sm' | 'md' | 'lg';
		href?: string;
		onclick?: (e: MouseEvent) => void;
		disabled?: boolean;
		fullWidth?: boolean;
		children?: Snippet;
		class?: string;
	}

	let {
		type = 'button',
		variant = 'white',
		size = 'md',
		href,
		onclick,
		disabled = false,
		fullWidth = false,
		children,
		class: className = ''
	}: Props = $props();

	const variantClasses = {
		white: 'bg-white text-black hover:bg-zinc-100 shadow-md',
		grey: 'bg-[#D9D9D9] text-zinc-900 hover:bg-[#E5E7EB] shadow-sm',
		purple: 'bg-[#6D24CB] text-white hover:bg-[#5b1cb3] shadow-md'
	};

	const sizeClasses = {
		sm: 'h-10 px-6 text-sm',
		md: 'h-12 px-8 text-base tracking-wide',
		lg: 'h-14 px-10 text-lg tracking-wider'
	};
</script>

{#if href}
	<a
		{href}
		class="inline-flex min-h-[44px] items-center justify-center rounded-full font-sans font-bold uppercase transition-all active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:pointer-events-none disabled:opacity-50 {variantClasses[variant]} {sizeClasses[size]} {fullWidth ? 'w-full' : ''} {className}"
	>
		{@render children?.()}
	</a>
{:else}
	<button
		{type}
		{onclick}
		{disabled}
		class="inline-flex min-h-[44px] items-center justify-center rounded-full font-sans font-bold uppercase transition-all active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:pointer-events-none disabled:opacity-50 {variantClasses[variant]} {sizeClasses[size]} {fullWidth ? 'w-full' : ''} {className}"
	>
		{@render children?.()}
	</button>
{/if}
