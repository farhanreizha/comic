<script lang="ts">
import { GENRES, type Genre, genreLabel } from "$lib/genres";
import { client } from "$lib/orpc";
import {
	errorText,
	formatMB,
	MAX_SEND_BYTES,
	mapWriteError,
	xhrUpload,
} from "$lib/write-ui";
import { m } from "$paraglide/messages.js";
import { ENV } from "../../varlock-env";

let { data } = $props();

/* $props() is a plain snapshot — assigning onto `data` never re-renders
 * (Svelte 5). Comics created this session live in local state and merge
 * into the load() list; filter guards a duplicate key if a refetch ever
 * lands the same comic in both. */
let fresh = $state<typeof data.comics>([]);
const comics = $derived([
	...fresh,
	...data.comics.filter((c) => !fresh.some((f) => f.id === c.id)),
]);

/* ------------------------------------------------ step 1: create comic */
let creating = $state(false);
let createMsg = $state<string | null>(null);
let createOk = $state<string | null>(null);
/* `$state<Set>` proxies don't make .has()/.add() deep-reactive in Svelte
 * 5.57 (proven in admin queues 2cca24c + upload e2e) — reassign a fresh
 * Set so the chip class binding re-reads and re-renders. */
let selectedGenres = $state<Set<Genre>>(new Set());

function toggleGenre(g: Genre) {
	selectedGenres = selectedGenres.has(g)
		? new Set([...selectedGenres].filter((x) => x !== g))
		: new Set([...selectedGenres, g]);
}

async function submitCreate(e: SubmitEvent) {
	e.preventDefault();
	if (creating) return;
	const form = e.target as HTMLFormElement;
	const fd = new FormData(form);
	creating = true;
	createMsg = null;
	createOk = null;
	try {
		const comic = await client.publishing.createComic({
			title: String(fd.get("title") ?? "").trim(),
			synopsis: String(fd.get("synopsis") ?? "").trim() || null,
			genres: [...selectedGenres],
		});
		createOk = comic.title;
		form.reset();
		selectedGenres = new Set();
		// the fresh comic belongs in step 2's selector without a reload
		fresh = [comic, ...fresh];
		targetComic = comic.id;
	} catch (error) {
		createMsg = errorText(mapWriteError(error));
	} finally {
		creating = false;
	}
}

/* ------------------------------------------------ step 2: upload chapter */
let targetComic = $state<string>("");
let dragging = $state(false);
let archive = $state<File | null>(null);
let images = $state<File[]>([]);
let progress = $state<number | null>(null);
let uploadMsg = $state<string | null>(null);
let uploadOk = $state<string | null>(null);

const files = $derived(archive ? [archive] : images);
const totalBytes = $derived(files.reduce((n, f) => n + f.size, 0));
/** Bytes are all sent (bar pegged at 100%) but the response hasn't
 *  landed — server is still ingesting (extract + decode + write, 5-30s).
 *  "Uploading… 100%" during that window reads as a hung UI (#40). */
const processing = $derived(progress === 1);
/** Client pre-check: past the transport ceiling the server answers an
 *  empty 413 no UI can explain — refuse before sending (app-ui.md). */
const tooBig = $derived(totalBytes > MAX_SEND_BYTES);

function setFiles(list: FileList | null) {
	if (!list || list.length === 0) return;
	if (list.length === 1) {
		archive = list[0];
		images = [];
	} else {
		images = [...list];
		archive = null;
	}
	uploadMsg = null;
	uploadOk = null;
}

function onDrop(e: DragEvent) {
	e.preventDefault();
	dragging = false;
	setFiles(e.dataTransfer?.files ?? null);
}

async function submitUpload(e: SubmitEvent) {
	e.preventDefault();
	if (progress !== null || !targetComic || files.length === 0) return;
	if (tooBig) {
		uploadMsg = m.upload_files_too_big({
			size: formatMB(totalBytes),
			limit: formatMB(MAX_SEND_BYTES),
		});
		return;
	}
	uploadMsg = null;
	uploadOk = null;
	const form = new FormData();
	form.set("comicId", targetComic);
	const title = String(
		new FormData(e.target as HTMLFormElement).get("chapterTitle") ?? "",
	).trim();
	if (title) form.set("title", title);
	if (archive) form.set("archive", archive);
	else for (const f of images) form.append("images", f);

	progress = 0;
	const outcome = await xhrUpload(
		`${ENV.PUBLIC_SERVER_URL}/publish/chapters`,
		form,
		(f) => (progress = Math.min(f, 1)),
	);
	progress = null;
	if (outcome.ok) {
		const ch = outcome.json as { title?: string };
		uploadOk = m.upload_done({ title: ch.title ?? "" });
		archive = null;
		images = [];
	} else {
		uploadMsg = errorText(mapWriteError(outcome.error));
	}
}
</script>

<svelte:head>
	<title>{m.upload_title()} — komik</title>
</svelte:head>

<div class="mx-auto max-w-3xl px-4 py-8">
	<h1 class="font-display text-3xl font-bold text-ink">{m.upload_title()}</h1>

	{#if data.gate === "anonymous"}
		<p class="mt-4 text-sm text-text-2">
			<a href="/auth" class="inline-flex min-h-7 items-center text-accent hover:underline">{m.upload_signin_prompt()}</a>
		</p>
	{:else if data.gate === "reader"}
		<p class="mt-4 text-sm text-ink">{m.upload_apply_cta()}</p>
		{#if data.applicationStatus === "pending"}
			<p class="mt-2 text-sm text-text-2">{m.apply_pending_note()}</p>
		{:else}
			<a
				href="/creator/apply"
				class="mt-3 inline-block bg-accent px-5 py-2 text-sm font-semibold text-bg transition-colors hover:bg-accent-dk"
			>
				{m.upload_apply_cta_link()}
			</a>
		{/if}
	{:else}
		<!-- Step 01 — create comic -->
		<section class="mt-6 border border-line bg-bg p-5">
			<div class="flex items-baseline gap-3">
				<span class="font-sans text-2xl font-extrabold text-accent">01</span>
				<h2 class="eyebrow">{m.upload_step1()}</h2>
			</div>
			<p class="mt-1 text-xs text-text-2">{m.upload_draft_note()}</p>
			<form class="mt-4 space-y-4" onsubmit={submitCreate}>
				<div>
					<label for="comic-title" class="block text-sm font-semibold text-ink">
						{m.upload_comic_title()}
					</label>
					<input
						id="comic-title"
						name="title"
						required
						maxlength="200"
						class="mt-1 w-full border border-line bg-bg p-2 text-sm text-ink"
					/>
				</div>
				<div>
					<label for="comic-synopsis" class="block text-sm font-semibold text-ink">
						{m.upload_comic_synopsis()}
					</label>
					<textarea
						id="comic-synopsis"
						name="synopsis"
						rows="3"
						maxlength="5000"
						class="mt-1 w-full border border-line bg-bg p-2 text-sm text-ink"
					></textarea>
				</div>
				<fieldset>
					<legend class="text-sm font-semibold text-ink">{m.upload_comic_genres()}</legend>
					<div class="mt-2 flex flex-wrap gap-2">
						{#each GENRES as g (g)}
							<label
								class="cursor-pointer border px-2 py-1 text-xs font-semibold uppercase tracking-wide {selectedGenres.has(g)
									? 'border-accent text-accent'
									: 'border-line text-text-2'}"
							>
								<input
									type="checkbox"
									class="sr-only"
									checked={selectedGenres.has(g)}
									onchange={() => toggleGenre(g)}
								/>
								{genreLabel(g)}
							</label>
						{/each}
					</div>
				</fieldset>
				<div class="flex items-center gap-3">
					<button
						type="submit"
						disabled={creating}
						class="bg-accent px-5 py-2 text-sm font-semibold text-bg transition-colors hover:bg-accent-dk disabled:opacity-60"
					>
						{m.upload_create_submit()}
					</button>
					{#if createOk}
						<span class="text-sm text-text-2">{m.upload_created()} — {createOk}</span>
					{/if}
				</div>
				{#if createMsg}
					<p class="text-sm text-accent" role="alert">{createMsg}</p>
				{/if}
			</form>
		</section>

		<!-- Step 02 — upload chapter -->
		<section class="mt-8 border border-line bg-bg p-5">
			<div class="flex items-baseline gap-3">
				<span class="font-sans text-2xl font-extrabold text-accent">02</span>
				<h2 class="eyebrow">{m.upload_step2()}</h2>
			</div>
			{#if comics.length === 0}
				<p class="mt-3 text-sm text-text-2">{m.upload_no_comics()}</p>
			{:else}
				<form class="mt-4 space-y-4" onsubmit={submitUpload}>
					<div>
						<label for="target-comic" class="block text-sm font-semibold text-ink">
							{m.upload_select_comic()}
						</label>
						<select
							id="target-comic"
							class="mt-1 w-full border border-line bg-bg p-2 text-sm text-ink"
							bind:value={targetComic}
						>
							{#each comics as c (c.id)}
								<option value={c.id}>{c.title}</option>
							{/each}
						</select>
					</div>
					<div>
						<label for="chapter-title" class="block text-sm font-semibold text-ink">
							{m.upload_chapter_title()}
						</label>
						<input
							id="chapter-title"
							name="chapterTitle"
							maxlength="200"
							class="mt-1 w-full border border-line bg-bg p-2 text-sm text-ink"
						/>
					</div>

					<!-- Drop zone: one CBZ/ZIP/PDF, or a multi-file image set -->
					<div
						class="border border-dashed border-line p-6 text-center transition-colors {dragging ? 'border-accent' : ''}"
						ondragover={(e) => {
							e.preventDefault();
							dragging = true;
						}}
						ondragleave={() => (dragging = false)}
						ondrop={onDrop}
					>
						<p class="text-sm text-ink">{m.upload_drop_zone()}</p>
						<input
							id="chapter-archive"
							type="file"
				accept=".cbz,.zip,.pdf,application/zip,application/pdf"
				class="mt-3 max-w-full text-sm text-text-2"
							onchange={(e) => setFiles((e.target as HTMLInputElement).files)}
						/>
						<p class="mt-3 text-xs text-text-2">{m.upload_or_images()}</p>
						<input
							type="file"
							accept="image/*"
							multiple
							class="mt-2 max-w-full text-sm text-text-2"
							onchange={(e) => setFiles((e.target as HTMLInputElement).files)}
						/>
					</div>

					{#if files.length > 0}
						<p class="text-sm text-ink">
							{files.length === 1 ? files[0].name : `${files.length} × image`}
							— {formatMB(totalBytes)}
							{#if tooBig}
								<span class="text-accent" role="alert">
									{m.upload_files_too_big({
										size: formatMB(totalBytes),
										limit: formatMB(MAX_SEND_BYTES),
									})}
								</span>
							{/if}
						</p>
					{/if}

					{#if progress !== null}
						<!-- Real XHR upload progress; cream track, crimson fill -->
						<div
							class="h-2 w-full overflow-hidden border border-line"
							role="progressbar"
							aria-valuemin={0}
							aria-valuemax={100}
							aria-valuenow={Math.round(progress * 100)}
							aria-valuetext={processing
								? m.upload_processing()
								: m.upload_progress({ pct: Math.round(progress * 100) })}
						>
							<div class="h-full bg-accent" style="width: {Math.round(progress * 100)}%"></div>
						</div>
						<p class="text-sm text-text-2">
							{processing
								? m.upload_processing()
								: m.upload_progress({ pct: Math.round(progress * 100) })}
						</p>
					{:else}
						<button
							type="submit"
							disabled={!targetComic || files.length === 0 || tooBig}
							class="bg-accent px-5 py-2 text-sm font-semibold text-bg transition-colors hover:bg-accent-dk disabled:opacity-60"
						>
							{m.upload_submit()}
						</button>
					{/if}

					{#if uploadOk}
						<p class="text-sm text-text-2">{uploadOk}</p>
					{/if}
					{#if uploadMsg}
						<p class="text-sm text-accent" role="alert">{uploadMsg}</p>
					{/if}
				</form>
			{/if}
		</section>
	{/if}
</div>
