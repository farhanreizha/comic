<script lang="ts">
import Skeleton from "$components/Skeleton.svelte";

// Issue #42: shelf-shaped placeholder — resume rows + card grid.
let { count = 8 }: { count?: number } = $props();
</script>

<div class="mt-8 space-y-10" aria-hidden="true">
	<section>
		<Skeleton class="h-3 w-24" />
		<div class="mt-3 space-y-3">
			{#each Array(3) as _, i (i)}
				<Skeleton class="h-[66px] w-full" rounded="rounded-sm" />
			{/each}
		</div>
	</section>
	<section>
		<Skeleton class="h-3 w-24" />
		<div class="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4 sm:gap-6">
			{#each Array(count) as _, i (i)}
				{@render cardSkeleton()}
			{/each}
		</div>
	</section>
</div>

{#snippet cardSkeleton()}
	<div>
		<Skeleton class="aspect-2/3 w-full" />
		<Skeleton class="mt-2 h-4 w-4/5" />
		<Skeleton class="mt-1.5 h-3 w-2/5" />
		<Skeleton class="mt-2 h-3 w-3/5" />
	</div>
{/snippet}
