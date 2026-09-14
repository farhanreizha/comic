<script lang="ts">
	import { createInfiniteQuery } from "@tanstack/svelte-query";
	import { browser } from "$app/environment";
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import { orpc } from "$lib/orpc";
	import { GENRES, genreLabel, type Genre } from "$lib/genres";
	import { m } from "$paraglide/messages.js";
	import ComicCard from "$components/ComicCard.svelte";

	const q = $derived(page.url.searchParams.get("q") ?? "");
	const genre = $derived(
		(page.url.searchParams.get("genre") ?? "") as Genre | "",
	);

	const browse = createInfiniteQuery(() =>
		orpc.reading.browse.infiniteOptions({
			input: (cursor: string | undefined) => ({
				q: q || undefined,
				genre: genre || undefined,
				cursor,
				limit: 20,
			}),
			initialPageParam: undefined as string | undefined,
			getNextPageParam: (last) => last.nextCursor ?? undefined,
		}),
	);

	const items = $derived(
		(browse.data?.pages ?? []).flatMap((p) => p.items as CardLike[]),
	);
	type CardLike = import("$components/ComicCard.svelte").CardComic;

	let searchBox = $state("");
	$effect(() => {
		searchBox = q;
	});

	function submitSearch(event: SubmitEvent) {
		event.preventDefault();
		const params = new URLSearchParams(page.url.searchParams);
		if (searchBox.trim()) params.set("q", searchBox.trim());
		else params.delete("q");
		void goto(`/?${params}`);
	}

	function pickGenre(event: Event) {
		const value = (event.target as HTMLSelectElement).value;
		const params = new URLSearchParams(page.url.searchParams);
		if (value) params.set("genre", value);
		else params.delete("genre");
		void goto(`/?${params}`);
	}

	$effect(() => {
		if (browser && page.url.searchParams.get("focus") === "search") {
			document.getElementById("browse-search")?.focus();
		}
	});
</script>

<svelte:head>
	<title>{m.browse_title()} — komik</title>
</svelte:head>

<div class="mx-auto max-w-6xl px-4">
	<div class="flex flex-wrap items-end gap-3 border-b border-line py-6">
		<form onsubmit={submitSearch} class="flex min-w-0 grow items-center gap-2 sm:grow-0" role="search">
			<label class="sr-only" for="browse-search">{m.browse_search_label()}</label>
			<input
				id="browse-search"
				type="search"
				bind:value={searchBox}
				placeholder={m.browse_search_placeholder()}
				class="w-full min-w-0 border border-line bg-bg px-3 py-2 text-sm text-ink placeholder:text-text-2 focus:border-accent focus:outline-none sm:w-64"
			/>
		</form>
		<label class="sr-only" for="genre-filter">{m.browse_genre_all()}</label>
		<select
			id="genre-filter"
			value={genre}
			onchange={pickGenre}
			class="border border-line bg-bg px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
		>
			<option value="">{m.browse_genre_all()}</option>
			{#each GENRES as g (g)}
				<option value={g}>{genreLabel(g)}</option>
			{/each}
		</select>
	</div>

	{#if browse.isPending}
		<div class="grid grid-cols-2 gap-4 py-8 sm:grid-cols-4 sm:gap-6">
			{#each Array(8) as _, i}
				<div class="aspect-2/3 animate-pulse border border-line bg-surface/40"></div>
			{/each}
		</div>
	{:else if items.length === 0}
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
</div>
