<script lang="ts">
import { onMount } from "svelte";
import { browser } from "$app/environment";
import { goto } from "$app/navigation";
import { page } from "$app/state";
import { client } from "$lib/orpc";
import { activeWindow, clampPage } from "$lib/reader";
import { m } from "$paraglide/messages.js";
import { ENV } from "../../../varlock-env";

// Chapter, page manifest, and comic come from the server load so the first
// paint is real content. Scroll window + progress throttle stay client-side.
let { data } = $props();

const chapterId = $derived(String(page.params.chapterId));
const chapter = $derived(data.chapter);
const pages = $derived(data.pages);
const signedIn = $derived(data.signedIn);

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

const totalPages = $derived(pages.length);

const nextChapter = $derived.by(() => {
	const idx = data.chapters.findIndex((ch) => ch.id === chapterId);
	return idx >= 0 && idx + 1 < data.chapters.length
		? data.chapters[idx + 1]
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
	// The strip's last child is the end-of-chapter block, not a page; and an
	// image still decoding can push the reading line past the real last page.
	current = Math.min(best, pages.length);
}

function scrollToPage(n: number) {
	const target = Math.min(Math.max(1, n), totalPages);
	const el = strip?.children[target - 1] as HTMLElement | undefined;
	// Smooth scroll across a 40-page gap is a slideshow; snap instead.
	el?.scrollIntoView({
		behavior: Math.abs(target - current) > 3 ? "instant" : "smooth",
		block: "start",
	});
	current = target;
}

function advance() {
	if (current >= totalPages) {
		if (nextChapter) void goto(`/read/${nextChapter.id}`);
		return;
	}
	scrollToPage(current + 1);
}

function retreat() {
	if (current > 1) scrollToPage(current - 1);
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
	// Escape always closes the jump field — it lands on the input itself.
	if (event.key === "Escape" && jumpOpen) {
		jumpOpen = false;
		jumpInput?.blur();
		return;
	}
	// Never hijack keys aimed at a focused control: Space on a focused
	// <button> already fires it, and typing in the jump input is not nav.
	const t = event.target as HTMLElement | null;
	if (t && (t.closest("input, textarea, select, button") || t.isContentEditable)) {
		return;
	}
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

function onJump(event: SubmitEvent) {
	event.preventDefault();
	const n = Number.parseInt(jumpValue, 10);
	if (Number.isFinite(n)) scrollToPage(n);
	jumpValue = "";
	// preventScroll: a plain focus() interrupts the smooth scrollIntoView
	// that scrollToPage just started (Chromium scrolls the focus target in).
	nextBar?.focus({ preventScroll: true });
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

	// Issue #43: show keyboard hint on first reader visit
	if (!sessionStorage.getItem("reader-hint-shown")) {
		sessionStorage.setItem("reader-hint-shown", "1");
		const hint = document.getElementById("reader-hint");
		if (hint) {
			setTimeout(() => hint.remove(), 3000);
		}
	}

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
	if (resumed || !browser || !signedIn || pages.length === 0) return;
	resumed = true;
	void client.reading
		.shelf()
		.then((s) => {
			const entry = s.continueReading.find((e) => e.chapter.id === chapterId);
			// Shelf progress can outlive the page manifest (pages deleted,
			// re-ingest) — clamp against what actually loaded.
			const target = Math.min(entry?.page ?? 1, pages.length);
			if (target > 1) {
				// Instant jump — a smooth scroll from page 1 is disorienting.
				const el = strip?.children[target - 1] as HTMLElement | undefined;
				el?.scrollIntoView({ block: "start" });
				current = target;
			}
		})
		.catch(() => {});
});

const progressLabel = $derived(
	totalPages > 0 ? m.reader_page_of({ page: current, total: totalPages }) : "",
);
const comicSlug = $derived(data.comic?.slug ?? "");

/* --- page jump: always-visible number input in the chrome bar --- */
let jumpOpen = $state(false);
let jumpValue = $state("");
let jumpInput: HTMLInputElement | undefined = $state();
let nextBar: HTMLButtonElement | undefined = $state();

function openJump() {
	jumpValue = "";
	jumpOpen = true;
}

$effect(() => {
	if (jumpOpen) requestAnimationFrame(() => jumpInput?.focus());
});

function submitJump() {
	const n = clampPage(Number(jumpValue), totalPages);
	scrollToPage(n);
	jumpOpen = false;
}
const chapterTitle = $derived(
	chapter.title || m.detail_chapter_title({ ordinal: chapter.ordinal }),
);
</script>

<svelte:head>
	<title>{chapterTitle} — komik</title>
</svelte:head>

<svelte:window onkeydown={onKey} />

<div class="min-h-svh bg-reader-bg">
	<!-- chrome -->
	<div
		class="sticky top-0 z-40 flex items-center gap-3 border-b border-reader-chrome bg-reader-chrome/95 px-3 py-2 text-sm backdrop-blur"
	>
		<a
			href="/comic/{comicSlug}"
			class="font-semibold text-reader-ink hover:text-reader-accent"
		>
			← {chapterTitle}
		</a>
		{#if jumpOpen}
			<form
				class="ml-auto flex items-center gap-1"
				novalidate
				onsubmit={(e) => {
					e.preventDefault();
					submitJump();
				}}
			>
				<input
					bind:this={jumpInput}
					bind:value={jumpValue}
					type="number"
					min="1"
					max={totalPages}
					inputmode="numeric"
					placeholder="1–{totalPages}"
					aria-label={m.reader_jump_to()}
					class="w-20 rounded-sm border border-reader-decor/40 bg-reader-chrome px-2 py-1 text-sm tabular-nums text-reader-ink outline-none focus:border-reader-accent"
				/>
				<button
					type="submit"
					class="bg-reader-accent px-3 py-1 text-sm font-bold text-reader-bg hover:opacity-90"
				>
					{m.reader_jump_go()}
				</button>
			</form>
		{:else}
			<button
				type="button"
				class="ml-auto tabular-nums text-reader-decor underline decoration-dotted underline-offset-4 hover:text-reader-accent"
				onclick={openJump}
				aria-expanded="false"
				aria-label={m.reader_jump_to()}
			>
				{progressLabel}
			</button>
		{/if}
	</div>

	<!-- progress bar -->
	<div class="sticky top-[37px] z-40 h-1.5 w-full overflow-hidden bg-reader-chrome" aria-hidden="true">
		<div
			class="h-full bg-reader-accent transition-[width] duration-150"
			style="width: {totalPages ? Math.min(1, current / totalPages) * 100 : 0}%"
		></div>
	</div>

	<!-- page controls: sticky bottom so they are reachable by thumb and Tab.
	     Tap/keys on the comic itself do nothing — only scroll + these buttons. -->
	<nav
		class="sticky bottom-0 z-40 flex items-center gap-2 border-t border-reader-chrome bg-reader-chrome/95 px-3 py-2 backdrop-blur"
		aria-label={m.reader_controls_label()}
	>
		<button
			type="button"
			class="prev-btn min-h-11 min-w-11 border border-reader-decor/40 px-3 text-sm font-semibold text-reader-ink transition-colors hover:border-reader-accent hover:text-reader-accent disabled:pointer-events-none disabled:opacity-40"
			onclick={retreat}
			disabled={current <= 1}
			title="{m.reader_prev()} (Page Up)"
		>
			← {m.reader_prev()}
		</button>
		<form class="ml-auto flex items-center gap-2" onsubmit={onJump}>
			<label class="text-xs text-reader-ink" for="reader-jump">{m.reader_page_input_label()}</label>
			<input
				id="reader-jump"
				type="number"
				min="1"
				max={totalPages}
				bind:value={jumpValue}
				class="w-16 border border-reader-decor/40 bg-reader-bg px-2 py-1.5 text-sm text-reader-ink"
			/>
			<button
				type="submit"
				class="min-h-11 border border-reader-decor/40 px-3 text-sm font-semibold text-reader-ink transition-colors hover:border-reader-accent hover:text-reader-accent"
			>
				{m.reader_go()}
			</button>
		</form>
		<button
			bind:this={nextBar}
			type="button"
			class="next-btn min-h-11 min-w-11 bg-reader-accent px-3 text-sm font-bold text-reader-bg transition-opacity hover:opacity-90"
			onclick={advance}
			title={current >= totalPages && nextChapter
				? m.reader_next_chapter_nav()
				: `${m.reader_next()} (Space)`}
		>
			{current >= totalPages && nextChapter ? m.reader_next_chapter_nav() : `${m.reader_next()} →`}
		</button>
	</nav>

	<!-- continuous strip; each slot reserves its aspect-ratio up front -->
	<div bind:this={strip} class="mx-auto max-w-[42rem]">
		{#each pages as p, i (p.id)}
			<div
				class="relative w-full"
				style="aspect-ratio: {p.width} / {p.height}"
				role="img"
				aria-label={m.reader_page_of({ page: i + 1, total: totalPages })}
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
			<a href="/comic/{comicSlug}" class="text-sm text-reader-accent underline">
				{m.reader_back_to_comic()}
			</a>
		</div>
	</div>
</div>

<!-- Issue #43: keyboard hint overlay (first visit, 3s auto-dismiss) -->
<div
	id="reader-hint"
	class="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center pt-6"
>
	<div class="bg-reader-accent px-4 py-2 text-sm text-reader-bg shadow-lg">
		{m.keyboard_reader_hint()}
	</div>
</div>
