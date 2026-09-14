<script lang="ts">
	import type { HTMLSelectAttributes } from "svelte/elements";
	import type { Snippet } from "svelte";

	let {
		label,
		hideLabel = false,
		error = undefined,
		class: className = "",
		id = undefined,
		children,
		...rest
	}: HTMLSelectAttributes & {
		label?: string;
		hideLabel?: boolean;
		error?: string | undefined;
		children: Snippet;
	} = $props();

	const control =
		"w-full border border-line bg-bg px-2 py-1 text-sm text-ink focus:outline-none focus-visible:border-accent disabled:text-decor";
</script>

<div class="space-y-1">
	{#if label}
		<label for={id} class={hideLabel ? "sr-only" : "block text-sm font-semibold text-ink"}>
			{label}
		</label>
	{/if}
	<select id={id} class="{control} {className}" aria-invalid={error ? "true" : undefined} {...rest}>
		{@render children()}
	</select>
	{#if error}
		<p class="text-sm text-accent" role="alert">{error}</p>
	{/if}
</div>
