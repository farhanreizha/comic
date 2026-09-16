<script lang="ts">
import { navigating } from "$app/state";
import { m } from "$paraglide/messages.js";

// Issue #42: one thin crimson rail covers every pending navigation.
// 150ms delay so instant (preloaded/cached) navigations never flash.
// `navigating.type === null` means no navigation is in flight.
const busy = $derived(navigating.type !== null && navigating.type !== "leave");

let show = $state(false);
$effect(() => {
	if (!busy) {
		show = false;
		return;
	}
	const t = setTimeout(() => (show = true), 150);
	return () => clearTimeout(t);
});
</script>

{#if show}
	<div class="rail" role="progressbar" aria-label={m.reader_loading()}>
		<span class="bar"></span>
	</div>
{/if}

<style>
	.rail {
		position: fixed;
		inset: 0 0 auto;
		z-index: 60;
		height: 3px;
		overflow: hidden;
		pointer-events: none;
	}
	.bar {
		display: block;
		height: 100%;
		width: 40%;
		background: var(--color-accent);
		animation: slide 1s ease-in-out infinite;
	}
	@keyframes slide {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(250%);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.bar {
			animation: none;
			width: 100%;
			opacity: 0.6;
		}
	}
</style>
