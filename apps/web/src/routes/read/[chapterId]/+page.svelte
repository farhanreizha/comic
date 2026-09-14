<script lang="ts">
import { createQuery } from "@tanstack/svelte-query";
import { onMount } from "svelte";
import { browser } from "$app/environment";
import { goto } from "$app/navigation";
import { page } from "$app/state";
import { client, orpc } from "$lib/orpc";
import { activeWindow } from "$lib/reader";
import { m } from "$paraglide/messages.js";
import { ENV } from "../../../env";

const chapterId = $derived(String(page.params.chapterId));

const chapterQuery = createQuery(() =>
	orpc.reading.read.queryOptions({
		input: { kind: "chapter", chapterId },
		staleTime: Number.POSITIVE_INFINITY,
	}),
);
const me = createQuery(() =>
	orpc.reading.me.queryOptions({ staleTime: 60_000 }),
);
const signedIn = $derived(Boolean(me.data?.signedIn));

const chapter = $derived(
	chapterQuery.data?.kind === "chapter" ? chapterQuery.data.chapter : null,
);
const pages = $derived(
	chapterQuery.data?.kind === "chapter" ? chapterQuery.data.pages : [],
);

// Comic slug for the "back" link; the chapter result only carries comicId.
const comicQuery = createQuery(() =>
	orpc.reading.read.queryOptions({
		input: { kind: "comic", ref: { id: chapter?.comicId ?? "" } },
		enabled: Boolean(chapter),
	}),
);
const totalPages = $derived(pages.length);

/** Pages within this many slots of the active one get real <img>s. */
const WINDOW = 5;
/** Progress is the page covering the viewport's reading line (its middle). */
let current = $state(1);
// ponytail: window recomputed from the scroll-derived `current` instead of
// per-slot IntersectionObservers — same ±5 pages, fewer moving parts.
const activeIds = $derived.by(() => {
	const [start, end] = activeWindow(current, pages.length, WINDOW);
	const set = new Set<string>();
	for (let i = start - 1; i < end; i++) set.add(pages[i].id);
	return set;
});

const nextChapter = $derived.by(() => {
	const comic = comicQuery.data;
	if (!comic || comic.kind !== "comic") return null;
	const idx = comic.chapters.findIndex((ch) => ch.id === chapterId);
	return idx >= 0 && idx + 1 < comic.chapters.length
		? comic.chapters[idx + 1]
		: null;
});

const imgSrc = (id: string) => `${ENV.PUBLIC_SERVER_URL}/pages/${id}`;

let strip: HTMLDivElement | undefined = $state();

function computeCurrent() {
	if (!strip || pages.length === 0) return;
	const line = window.innerHeight / 2;
	let best = 1;
	let bestDist = Number.POSITIVE_INFINITY;
	for (let i = 0; i < strip.children.length; i++) {
		const el = strip.children[i] as HTMLElement;
		const r = el.getBoundingClientRect();
		if (r.top <= line && r.bottom >= line) {
			best = i + 1;
			bestDist = 0;
			break;
		}
		const dist = r.top > line ? r.top - line : line - r.bottom;
		if (dist < bestDist) {
			bestDist = dist;
			best = i + 1;
		}
	}
	current = best;
}

function scrollToPage(n: number) {
	const target = Math.min(Math.max(1, n), totalPages);
	const el = strip?.children[target - 1] as HTMLElement | undefined;
	el?.scrollIntoView({ behavior: "smooth", block: "start" });
	current = target;
}

function advance() {
	if (current >= totalPages) {
		if (nextChapter) void goto(`/read/${nextChapter.id}`);
		return;
	}
	scrollToPage(current + 1);
}

/* --- progress: throttled writes, flushed on visibilitychange --- */
const PROGRESS_MS = 2000;
let dirty = false;
let lastSent = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

function sendProgress() {
	if (!signedIn || !dirty || !current) return;
	void client.reading
		.recordProgress({ chapterId, page: current })
		.catch(() => {});
	dirty = false;
	lastSent = Date.now();
}

function scheduleProgress() {
	dirty = true;
	const wait = PROGRESS_MS - (Date.now() - lastSent);
	if (wait <= 0) {
		if (timer) clearTimeout(timer);
		timer = undefined;
		sendProgress();
	} else if (!timer) {
		timer = setTimeout(() => {
			timer = undefined;
			sendProgress();
		}, wait);
	}
}

$effect(() => {
	if (current && browser) scheduleProgress();
});

function onKey(event: KeyboardEvent) {
	if (event.key === "PageDown" || event.key === " ") {
		event.preventDefault();
		advance();
	} else if (event.key === "PageUp") {
		event.preventDefault();
		scrollToPage(current - 1);
	} else if (event.key === "ArrowDown") {
		/* native scroll */
	}
}

function onVisibility() {
	if (document.visibilityState === "hidden") sendProgress();
}

onMount(() => {
	computeCurrent();
	if (pages.length === 0) return;
	let raf = 0;
	const onScroll = () => {
		cancelAnimationFrame(raf);
		raf = requestAnimationFrame(computeCurrent);
	};
	window.addEventListener("scroll", onScroll, { passive: true });
	document.addEventListener("visibilitychange", onVisibility);
	return () => {
		window.removeEventListener("scroll", onScroll);
		document.removeEventListener("visibilitychange", onVisibility);
		cancelAnimationFrame(raf);
		if (timer) clearTimeout(timer);
		sendProgress();
	};
});

// Resume position: the shelf's continue entry for this chapter, if any.
let resumed = $state(false);
$effect(() => {
	if (resumed || !signedIn || pages.length === 0) return;
	resumed = true;
	void client.reading
		.shelf()
		.then((s) => {
			const entry = s.continueReading.find((e) => e.chapter.id === chapterId);
			if (entry && entry.page > 1) {
				// Instant jump — a smooth scroll from page 1 is disorienting.
				const el = strip?.children[entry.page - 1] as HTMLElement | undefined;
				el?.scrollIntoView({ block: "start" });
				current = entry.page;
			}
		})
		.catch(() => {});
});

const progressLabel = $derived(
	totalPages > 0 ? m.reader_page_of({ page: current, total: totalPages }) : "",
);
</script>

<svelte:head>
	<title>{chapterQuery.data?.kind === "chapter"
		? chapterQuery.data.chapter.title
		: m.reader_loading()} — komik</title>
</svelte:head>

<svelte:window onkeydown={onKey} onclick={(e) => e.target === document.body && advance()} />

{#if chapterQuery.isPending}
	<div class="flex min-h-svh items-center justify-center bg-reader-bg font-sans text-reader-decor">
		{m.reader_loading()}
	</div>
{:else if chapterQuery.error || chapterQuery.data?.kind !== "chapter"}
	<div class="flex min-h-svh flex-col items-center justify-center gap-4 bg-reader-bg font-sans">
		<p class="text-reader-decor">{m.reader_not_found()}</p>
		<a href="/" class="text-reader-accent underline">{m.reader_back_to_comic()}</a>
	</div>
{:else}
	<div class="min-h-svh bg-reader-bg">
		<!-- chrome -->
		<div
			class="sticky top-0 z-40 flex items-center gap-3 border-b border-reader-chrome bg-reader-chrome/95 px-3 py-2 text-sm backdrop-blur"
		>
			<a
				href="/comic/{comicQuery.data?.kind === 'comic' ? comicQuery.data.comic.slug : ''}"
				class="font-semibold text-reader-ink hover:text-reader-accent"
			>
				← {chapterQuery.data.chapter.title ||
					m.detail_chapter_title({ ordinal: chapterQuery.data.chapter.ordinal })}
			</a>
			<span class="ml-auto tabular-nums text-reader-decor">{progressLabel}</span>
		</div>

		<!-- progress bar -->
		<div class="sticky top-[37px] z-40 h-0.5 w-full bg-reader-chrome" aria-hidden="true">
			<div
				class="h-full bg-reader-accent transition-[width] duration-150"
				style="width: {totalPages ? (current / totalPages) * 100 : 0}%"
			></div>
		</div>

		<!-- continuous strip; each slot reserves its aspect-ratio up front -->
		<div bind:this={strip} class="mx-auto max-w-[42rem]">
			{#each pages as p, i (p.id)}
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_click_events_have_key_events -->
				<div
					class="relative w-full"
					style="aspect-ratio: {p.width} / {p.height}"
					role="img"
					aria-label={m.reader_page_of({ page: i + 1, total: totalPages })}
					onclick={(e) => {
						e.stopPropagation();
						advance();
					}}
				>
					{#if activeIds.has(p.id)}
						<img
							src={imgSrc(p.id)}
							alt=""
							loading="lazy"
							decoding="async"
							class="absolute inset-0 size-full object-contain"
						/>
					{:else}
						<div class="absolute inset-0 flex items-center justify-center text-xs text-reader-decor">
							{i + 1}
						</div>
					{/if}
				</div>
			{/each}

			<!-- end-of-chapter -->
			<div class="flex flex-col items-center gap-3 py-12 text-center">
				{#if nextChapter}
					<a
						href="/read/{nextChapter.id}"
						class="bg-reader-accent px-6 py-3 text-sm font-bold text-reader-bg transition-opacity hover:opacity-90"
					>
						{m.reader_next_chapter_label({ ordinal: nextChapter.ordinal })}
					</a>
					<span class="text-xs text-reader-decor">{m.reader_next_chapter()}</span>
				{/if}
				<a href="/comic/{comicQuery.data?.kind === 'comic' ? comicQuery.data.comic.slug : ''}"
					class="text-sm text-reader-accent underline">
					{m.reader_back_to_comic()}
				</a>
			</div>
		</div>
	</div>
{/if}
