<script lang="ts">
// Issue #42: one shimmer primitive; geometry composed by the caller.
// `animation: appear … both` holds opacity 0 for 150ms so fast (cached/
// streamed) loads never flash the skeleton.
let {
	class: klass = "",
	rounded = "rounded-none",
}: { class?: string; rounded?: string } = $props();
</script>

<span class="sk inline-block bg-surface/70 {rounded} {klass}" aria-hidden="true"></span>

<style>
	.sk {
		animation:
			appear 0.01ms 150ms both,
			shimmer 1.4s 150ms ease-in-out infinite;
		background-image: linear-gradient(
			90deg,
			transparent 0%,
			rgb(255 255 255 / 0.55) 50%,
			transparent 100%
		);
		background-size: 200% 100%;
	}
	@keyframes appear {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	@keyframes shimmer {
		from {
			background-position: 100% 0;
		}
		to {
			background-position: -100% 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.sk {
			animation: appear 0.01ms 150ms both;
		}
	}
</style>
