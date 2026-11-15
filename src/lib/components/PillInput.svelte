<script lang="ts">
	interface Props {
		type?: 'text' | 'password' | 'email';
		placeholder?: string;
		value?: string;
		name?: string;
		required?: boolean;
		ariaLabel?: string;
		oninput?: (e: Event & { currentTarget: HTMLInputElement }) => void;
		class?: string;
	}

	let {
		type = 'text',
		placeholder = '',
		value = $bindable(''),
		name,
		required = false,
		ariaLabel,
		oninput,
		class: className = ''
	}: Props = $props();
</script>

<div class="relative w-full">
	<input
		{type}
		{name}
		{required}
		bind:value
		{oninput}
		placeholder={placeholder.toUpperCase()}
		aria-label={ariaLabel || placeholder}
		class="h-12 w-full min-h-[44px] rounded-full bg-[#D9D9D9] px-6 font-sans text-base font-bold text-zinc-900 placeholder:font-bold placeholder:text-zinc-800 transition-all focus:bg-white focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-[#511A9A] {className}"
	/>
</div>
