<script lang="ts">
	import type { HTMLTextareaAttributes } from "svelte/elements";

	let {
		label,
		hideLabel = false,
		error = undefined,
		class: className = "",
		id = undefined,
		...rest
	}: HTMLTextareaAttributes & {
		label?: string;
		hideLabel?: boolean;
		error?: string | undefined;
	} = $props();

	const control =
		"w-full border border-line bg-bg p-2 text-sm text-ink placeholder:text-decor focus:outline-none focus-visible:border-accent";
</script>

<div class="space-y-1">
	{#if label}
		<label for={id} class={hideLabel ? "sr-only" : "block text-sm font-semibold text-ink"}>
			{label}
		</label>
	{/if}
	<textarea id={id} class="{control} {className}" aria-invalid={error ? "true" : undefined} {...rest}></textarea>
	{#if error}
		<p class="text-sm text-accent" role="alert">{error}</p>
	{/if}
</div>
