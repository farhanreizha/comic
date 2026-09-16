<script lang="ts">
import Skeleton from "$components/Skeleton.svelte";

// Issue #42: browse-grid-shaped placeholder (ComicCard geometry).
let { count = 8 }: { count?: number } = $props();
</script>

<div class="grid grid-cols-2 gap-4 py-8 sm:grid-cols-4 sm:gap-6" aria-hidden="true">
	{#each Array(count) as _, i (i)}
		<div>
			<Skeleton class="aspect-2/3 w-full" />
			<Skeleton class="mt-2 h-4 w-4/5" />
			<Skeleton class="mt-1.5 h-3 w-2/5" />
			<Skeleton class="mt-2 h-3 w-3/5" />
		</div>
	{/each}
</div>
