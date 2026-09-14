<script lang="ts">
	import { createQuery } from "@tanstack/svelte-query";
	import { orpc } from "$lib/orpc";
	import { m } from "$paraglide/messages.js";
	import ComicCard from "$components/ComicCard.svelte";
	import { ENV } from "../../env";

	const me = createQuery(() =>
		orpc.reading.me.queryOptions({ staleTime: 60_000 }),
	);
	const signedIn = $derived(Boolean(me.data?.signedIn));

	const shelfQuery = createQuery(() =>
		orpc.reading.shelf.queryOptions({ enabled: signedIn }),
	);

	const saved = $derived(shelfQuery.data?.saved ?? []);
	const continuing = $derived(shelfQuery.data?.continueReading ?? []);

	const cover = (url: string | null) =>
		url ? `${ENV.PUBLIC_SERVER_URL}${url}` : null;
</script>

<svelte:head>
	<title>{m.library_title()} — komik</title>
</svelte:head>

<div class="mx-auto max-w-6xl px-4 py-8">
	<h1 class="font-display text-3xl font-bold text-ink">{m.library_title()}</h1>

	{#if !signedIn}
		<p class="mt-6 text-sm text-text-2">{m.library_signin_prompt()}</p>
	{:else if shelfQuery.isPending}
		<div class="mt-6 space-y-4">
			<div class="h-4 w-40 animate-pulse bg-surface/60"></div>
			<div class="h-4 w-40 animate-pulse bg-surface/40"></div>
		</div>
	{:else}
		<section class="mt-8">
			<h2 class="eyebrow">{m.library_continue()}</h2>
			{#if continuing.length === 0}
				<p class="mt-2 text-sm text-text-2">{m.library_continue_empty()}</p>
			{:else}
				<ul class="mt-3 space-y-3">
					{#each continuing as entry (entry.chapter.id)}
						<li>
							<a
								href="/read/{entry.chapter.id}"
								class="flex items-center gap-4 border border-line p-3 transition-colors hover:border-accent"
							>
								<span class="block size-12 shrink-0 overflow-hidden border border-line bg-surface">
									{#if cover(entry.comic.coverUrl)}
										<img src={cover(entry.comic.coverUrl)} alt="" class="size-full object-cover" />
									{/if}
								</span>
								<span class="min-w-0">
									<span class="block truncate font-display font-bold text-ink">{entry.comic.title}</span>
									<span class="block truncate text-sm text-text-2">
										{m.library_resume({ chapter: entry.chapter.ordinal, page: entry.page })}
									</span>
								</span>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="mt-10">
			<h2 class="eyebrow">{m.library_saved()}</h2>
			{#if saved.length === 0}
				<p class="mt-2 text-sm text-text-2">{m.library_saved_empty()}</p>
			{:else}
				<div class="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4 sm:gap-6">
					{#each saved as comic (comic.slug)}
						<ComicCard {comic} />
					{/each}
				</div>
			{/if}
		</section>
	{/if}
</div>
