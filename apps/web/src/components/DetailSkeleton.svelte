<script lang="ts">
import Skeleton from "$components/Skeleton.svelte";
</script>

<!-- Issue #42: detail-page-shaped placeholder (cover column + metadata rows). -->
<div class="mt-4 grid gap-8 md:grid-cols-[280px_1fr]" aria-hidden="true">
	<Skeleton class="aspect-2/3 w-full" />
	<div class="min-w-0">
		<Skeleton class="h-9 w-2/3" />
		<Skeleton class="mt-3 h-4 w-40" />
		<div class="mt-4 flex gap-1">
			{#each Array(3) as _, i (i)}
				<Skeleton class="h-5 w-16" />
			{/each}
		</div>
		<Skeleton class="mt-6 h-5 w-32" />
		<div class="mt-6 flex gap-2">
			<Skeleton class="h-10 w-36" />
			<Skeleton class="h-10 w-28" />
		</div>
		<Skeleton class="mt-10 h-3 w-24" />
		{#each Array(3) as _, i (i)}
			<Skeleton class="mt-3 h-4 w-full" />
		{/each}
	</div>
</div>
<Skeleton class="mt-12 h-3 w-24" />
{#each Array(4) as _, i (i)}
	<Skeleton class="mt-4 h-4 w-full" />
{/each}
