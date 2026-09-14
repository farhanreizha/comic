<script lang="ts" module>
	export type ButtonVariant = "primary" | "secondary" | "ghost";
	export type ButtonSize = "sm" | "md";
</script>

<script lang="ts">
	import type { Snippet } from "svelte";
	import type { HTMLButtonAttributes } from "svelte/elements";

	let {
		variant = "primary",
		size = "md",
		class: className = "",
		children,
		...rest
	}: HTMLButtonAttributes & {
		variant?: ButtonVariant;
		size?: ButtonSize;
		children: Snippet;
	} = $props();

	const base =
		"inline-flex items-center justify-center font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";

	const variants: Record<ButtonVariant, string> = {
		primary: "bg-accent text-bg hover:bg-accent-dk",
		secondary:
			"border border-line text-text-2 hover:border-accent hover:text-accent",
		ghost: "text-text-2 hover:text-accent",
	};

	const sizes: Record<ButtonSize, string> = {
		sm: "px-4 py-1.5 text-sm",
		md: "px-5 py-2 text-sm",
	};
</script>

<button
	class="{base} {variants[variant]} {sizes[size]} {className}"
	{...rest}
>
	{@render children()}
</button>
