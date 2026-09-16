<script lang="ts">
import { browser } from "$app/environment";
import { goto } from "$app/navigation";
import { page } from "$app/state";
import BrowseResults from "$components/BrowseResults.svelte";
import GridSkeleton from "$components/GridSkeleton.svelte";
import { GENRES, type Genre, genreLabel } from "$lib/genres";
import { m } from "$paraglide/messages.js";

// Issue #42: the toolbar paints instantly; the first catalogue page streams
// as a pending promise (data.page1) and swaps the skeleton on resolve.
let { data } = $props();

const q = $derived(page.url.searchParams.get("q") ?? "");
const genre = $derived(
	(page.url.searchParams.get("genre") ?? "") as Genre | "",
);

let searchBox = $state("");
$effect(() => {
	searchBox = q;
});

function submitSearch(event: SubmitEvent) {
	event.preventDefault();
	const params = new URLSearchParams(page.url.searchParams);
	if (searchBox.trim()) params.set("q", searchBox.trim());
	else params.delete("q");
	params.delete("cursor");
	void goto(`/?${params}`);
}

function pickGenre(event: Event) {
	const value = (event.target as HTMLSelectElement).value;
	const params = new URLSearchParams(page.url.searchParams);
	if (value) params.set("genre", value);
	else params.delete("genre");
	params.delete("cursor");
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

	{#await data.page1}
		<!-- Issue #42: shell paints instantly; skeleton covers the streamed
		     first page (its 150ms fade keeps fast resolves flash-free). -->
		<GridSkeleton />
	{:then page1}
		<BrowseResults {page1} />
	{:catch}
		<!-- page1 catches internally; unreachable in practice. -->
		<p class="py-16 text-center text-text-2">{m.browse_empty()}</p>
	{/await}
</div>
