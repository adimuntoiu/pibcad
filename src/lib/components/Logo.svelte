<script lang="ts">
	interface Props {
		accent?: 'purple' | 'light' | 'white';
		size?: 'sm' | 'md' | 'lg' | 'xl';
		class?: string;
	}

	let {
		accent = 'light',
		size = 'md',
		class: className = ''
	}: Props = $props();

	const sizeClasses = {
		sm: 'text-2xl tracking-tight',
		md: 'text-3xl sm:text-4xl tracking-tight',
		lg: 'text-5xl tracking-normal',
		xl: 'text-6xl tracking-normal'
	};

	const accentColorClass = {
		purple: 'text-[#6D24CB]',
		light: 'text-white',
		white: 'text-white'
	};
</script>

<div
	class="inline-flex select-none items-baseline font-display font-bold leading-none text-black {sizeClasses[size]} {className}"
	aria-label="artizART"
>
	<span>artiz</span>
	<span class={accentColorClass[accent]}>AR</span>
	<span>t</span>
</div>
