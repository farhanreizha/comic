<script lang="ts">
import { createInfiniteQuery } from "@tanstack/svelte-query";
import { page } from "$app/state";
import ComicCard from "$components/ComicCard.svelte";
import type { Genre } from "$lib/genres";
import { client, orpc } from "$lib/orpc";
import { m } from "$paraglide/messages.js";

type BrowsePage = Awaited<ReturnType<typeof client.reading.browse>>;

// Only mounted once the streamed first page resolves — it seeds the infinite
// query with that page and owns "load more" from there.
let { page1 }: { page1: BrowsePage } = $props();

const q = $derived(page.url.searchParams.get("q") ?? "");
const genre = $derived(
	(page.url.searchParams.get("genre") ?? "") as Genre | "",
);
const cursor = $derived(page.url.searchParams.get("cursor") ?? undefined);

const browse = createInfiniteQuery(() =>
	orpc.reading.browse.infiniteOptions({
		input: (nextCursor: string | undefined) => ({
			q: q || undefined,
			genre: genre || undefined,
			cursor: nextCursor,
			limit: 20,
		}),
		initialPageParam: cursor,
		getNextPageParam: (last: BrowsePage) => last.nextCursor ?? undefined,
		initialData: () => ({
			pages: [page1] as BrowsePage[],
			pageParams: [cursor] as (string | undefined)[],
		}),
	}),
);

const items = $derived((browse.data?.pages ?? []).flatMap((p) => p.items));
</script>

{#if items.length === 0}
	<p class="py-16 text-center text-text-2">{m.browse_empty()}</p>
{:else}
	<div class="grid grid-cols-2 gap-4 py-8 sm:grid-cols-4 sm:gap-6">
		{#each items as comic (comic.slug)}
			<ComicCard {comic} />
		{/each}
	</div>
	{#if browse.hasNextPage}
		<div class="pb-12 text-center">
			<button
				type="button"
				onclick={() => browse.fetchNextPage()}
				disabled={browse.isFetchingNextPage}
				class="border border-accent px-6 py-2 text-sm font-semibold text-accent transition-colors hover:bg-accent hover:text-bg disabled:opacity-50"
			>
				{m.browse_load_more()}
			</button>
		</div>
	{/if}
{/if}
