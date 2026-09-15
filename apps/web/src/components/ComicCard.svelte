<script lang="ts">
import { type Genre, genreLabel } from "$lib/genres";
import { m } from "$paraglide/messages.js";
import { ENV } from "../varlock-env";

export type CardComic = {
	slug: string;
	title: string;
	coverUrl: string | null;
	creator: { id: string; name: string };
	genres: Genre[];
	chapterCount: number;
};

let { comic }: { comic: CardComic } = $props();

// Covers are page ids served by the image route — never a file path.
const cover = $derived(
	comic.coverUrl ? `${ENV.PUBLIC_SERVER_URL}${comic.coverUrl}` : null,
);
</script>

<article class="group">
	<a href="/comic/{comic.slug}" class="block">
		<div
			class="aspect-[2/3] w-full overflow-hidden border border-line bg-surface transition-colors group-hover:border-accent"
		>
			{#if cover}
				<img
					src={cover}
					alt={comic.title}
					loading="lazy"
					class="size-full object-cover"
				/>
			{:else}
				<div class="flex size-full items-center justify-center">
					<span class="diamond"></span>
				</div>
			{/if}
		</div>
		<h3
			class="mt-2 line-clamp-2 font-display text-base leading-snug font-bold text-ink group-hover:text-accent"
		>
			{comic.title}
		</h3>
	</a>
	<p class="text-sm text-text-2">{m.detail_by({ name: comic.creator.name })}</p>
	<div class="mt-1.5 flex flex-wrap gap-1">
		{#each comic.genres.slice(0, 3) as g (g)}
			<span class="border border-line px-1.5 py-0.5 text-[0.65rem] font-semibold tracking-wide text-text-2 uppercase">
				{genreLabel(g)}
			</span>
		{/each}
	</div>
	<p class="mt-1 text-xs text-text-2">
		{comic.chapterCount === 1
			? m.browse_one_chapter()
			: m.browse_chapters({ count: comic.chapterCount })}
	</p>
</article>
