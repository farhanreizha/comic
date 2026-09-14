<script lang="ts">
import { createQuery } from "@tanstack/svelte-query";
import { page } from "$app/state";
import { genreLabel } from "$lib/genres";
import { client, orpc } from "$lib/orpc";
import { shelf } from "$lib/shelf";
import { m } from "$paraglide/messages.js";
import { ENV } from "../../../env";

const slug = $derived(String(page.params.slug));

const comicQuery = createQuery(() =>
	orpc.reading.read.queryOptions({
		input: { kind: "comic", ref: { slug } },
	}),
);
const me = createQuery(() =>
	orpc.reading.me.queryOptions({ staleTime: 60_000 }),
);
const signedIn = $derived(Boolean(me.data?.signedIn));

const comic = $derived(
	comicQuery.data?.kind === "comic" ? comicQuery.data : null,
);
const detail = $derived(comic?.comic ?? null);

// Social entry points require a viewer; anonymous viewers get UNAUTHORIZED.
const rating = createQuery(() =>
	orpc.social.ratingSummary.queryOptions({
		input: { comicId: detail?.id ?? "" },
		enabled: signedIn && Boolean(detail),
	}),
);
const comments = createQuery(() =>
	orpc.social.listComments.queryOptions({
		input: { comicId: detail?.id ?? "", limit: 20 },
		enabled: signedIn && Boolean(detail),
	}),
);

const saved = $derived(detail ? $shelf.includes(detail.id) : false);

// No is-following read path exists yet; the CONFLICT from follow tells us.
let following = $state(false);
async function toggleFollow() {
	if (!detail) return;
	try {
		if (following)
			await client.social.unfollow({ creatorId: detail.creator.id });
		else await client.social.follow({ creatorId: detail.creator.id });
		following = !following;
	} catch (error) {
		if ((error as { code?: string }).code === "CONFLICT") following = true;
	}
}

const cover = $derived(
	detail?.coverUrl ? `${ENV.PUBLIC_SERVER_URL}${detail.coverUrl}` : null,
);
const chapters = $derived(comic?.chapters ?? []);
const firstChapter = $derived(chapters[0] ?? null);
</script>

<svelte:head>
	<title>{detail?.title ?? `${slug} — komik`}</title>
</svelte:head>

<div class="mx-auto max-w-6xl px-4 py-8">
	{#if comicQuery.isPending}
		<div class="grid gap-8 md:grid-cols-[280px_1fr]">
			<div class="aspect-2/3 animate-pulse border border-line bg-surface/40"></div>
			<div class="space-y-4 py-4">
				<div class="h-8 w-2/3 animate-pulse bg-surface/60"></div>
				<div class="h-4 w-1/3 animate-pulse bg-surface/40"></div>
			</div>
		</div>
	{:else if comicQuery.error || !comic || !detail}
		<p class="py-16 text-center text-text-2">{m.detail_not_found()}</p>
	{:else}
		<a href="/" class="eyebrow">{m.detail_back()}</a>
		<div class="mt-4 grid gap-8 md:grid-cols-[280px_1fr]">
			<!-- Visual anchor: cover, or the first page's cover when there is one -->
			<a href="/read/{firstChapter?.id ?? ''}" class="block">
				<div class="aspect-2/3 w-full overflow-hidden border border-line bg-surface">
					{#if cover}
						<img src={cover} alt={detail.title} class="size-full object-cover" />
					{:else}
						<div class="flex size-full items-center justify-center">
							<span class="diamond"></span>
						</div>
					{/if}
				</div>
			</a>

			<div class="min-w-0">
				<h1 class="font-display text-3xl font-bold leading-tight text-ink sm:text-4xl">
					{detail.title}
				</h1>
				<p class="mt-1 text-text-2">{m.detail_by({ name: detail.creator.name })}</p>

				<div class="mt-3 flex flex-wrap gap-1">
					{#each detail.genres as g (g)}
						<span class="border border-line px-1.5 py-0.5 text-[0.65rem] font-semibold tracking-wide text-text-2 uppercase">
							{genreLabel(g)}
						</span>
					{/each}
				</div>

				<p class="mt-4 text-sm text-text-2">
					{#if rating.data}
						{#if rating.data.count > 0}
							{m.detail_rating({
								avg: rating.data.average?.toFixed(1) ?? "–",
								count: rating.data.count,
							})}
						{:else}
							{m.detail_rating_none()}
						{/if}
					{/if}
				</p>

				<div class="mt-4 flex flex-wrap gap-2">
					{#if firstChapter}
						<a
							href="/read/{firstChapter.id}"
							class="bg-accent px-5 py-2 text-sm font-semibold text-bg transition-colors hover:bg-accent-dk"
						>
							{m.detail_read_first()}
						</a>
					{/if}
					<button
						type="button"
						onclick={() => detail && shelf.toggle(detail.id)}
						class="border px-5 py-2 text-sm font-semibold transition-colors {saved
							? 'border-accent text-accent'
							: 'border-line text-text-2 hover:border-accent hover:text-accent'}"
					>
						{saved ? m.detail_saved() : m.detail_save()}
					</button>
					{#if signedIn}
						<button
							type="button"
							onclick={toggleFollow}
							class="border px-5 py-2 text-sm font-semibold transition-colors {following
								? 'border-accent text-accent'
								: 'border-line text-text-2 hover:border-accent hover:text-accent'}"
						>
							{following ? m.detail_following() : m.detail_follow()}
						</button>
					{:else}
						<span class="self-center text-xs text-text-2">{m.detail_follow_unavailable()}</span>
					{/if}
				</div>

				<section class="mt-8">
					<h2 class="eyebrow">{m.detail_synopsis()}</h2>
					<p class="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink">
						{comic.synopsis || m.detail_no_synopsis()}
					</p>
				</section>
			</div>
		</div>

		<section class="mt-10">
			<h2 class="eyebrow">{m.detail_chapters()}</h2>
			{#if chapters.length === 0}
				<p class="mt-2 text-sm text-text-2">{m.detail_no_chapters()}</p>
			{:else}
				<ol class="mt-3 divide-y divide-line border-y border-line">
					{#each chapters as ch (ch.id)}
						<li>
							<a
								href="/read/{ch.id}"
								class="flex items-baseline justify-between gap-4 py-3 text-sm hover:text-accent"
							>
								<span class="font-semibold text-ink">{ch.title || m.detail_chapter_title({ ordinal: ch.ordinal })}</span>
								<span class="shrink-0 text-text-2">{m.detail_page_count({ count: ch.pageCount })}</span>
							</a>
						</li>
					{/each}
				</ol>
			{/if}
		</section>

		<section class="mt-10">
			<h2 class="eyebrow">{m.detail_comments()}</h2>
			{#if !signedIn}
				<p class="mt-2 text-sm text-text-2">{m.error_unauthenticated()}</p>
			{:else if comments.isPending}
				<p class="mt-2 text-sm text-text-2">{m.reader_loading()}</p>
			{:else if !comments.data || comments.data.items.length === 0}
				<p class="mt-2 text-sm text-text-2">{m.detail_comments_empty()}</p>
			{:else}
				<ul class="mt-3 space-y-4 border-t border-line pt-4">
					{#each comments.data.items as c (c.id)}
						<li class="text-sm">
							<p class="font-semibold text-ink">{c.author.name}</p>
							<p class="mt-0.5 whitespace-pre-line text-ink">{c.body}</p>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}
</div>
