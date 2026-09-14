<script lang="ts">
import { goto, invalidate } from "$app/navigation";
import { page } from "$app/state";
import { GENRES, type Genre, genreLabel } from "$lib/genres";
import { client } from "$lib/orpc";
import { errorText, mapWriteError } from "$lib/write-ui";
import { m } from "$paraglide/messages.js";
import { ENV } from "../../../env";

// Comic, chapters, rating, comments, shelf + follow initial state come from
// the server load. Client state only mirrors the server after a mutation.
let { data } = $props();

const detail = $derived(data.comic);
const slug = $derived(String(page.params.slug));
const signedIn = $derived(data.signedIn);

// svelte-ignore state_referenced_locally -- initial server state, by design
let saved = $state(data.saved);
let saving = $state(false);
let saveError = $state(false);
async function toggleSave() {
	if (saving) return;
	saving = true;
	const was = saved;
	saved = !was;
	saveError = false;
	try {
		if (was) await client.reading.unsaveComic({ comicId: detail.id });
		else await client.reading.saveComic({ comicId: detail.id });
	} catch {
		saved = was; // failed mutation reverts
		saveError = true;
	} finally {
		saving = false;
	}
}

// svelte-ignore state_referenced_locally -- initial server state, by design
let following = $state(data.following);
let followingBusy = $state(false);
let followError = $state(false);
async function toggleFollow() {
	if (followingBusy) return;
	followingBusy = true;
	const was = following;
	following = !was;
	followError = false;
	try {
		if (was) await client.social.unfollow({ creatorId: detail.creator.id });
		else await client.social.follow({ creatorId: detail.creator.id });
	} catch {
		following = was; // failed mutation reverts
		followError = true;
	} finally {
		followingBusy = false;
	}
}

// Posting a comment re-runs the server load, so the list stays the
// server-rendered truth rather than a client-side copy.
let commentBusy = $state(false);
let commentError = $state(false);
async function submitComment(e: SubmitEvent) {
	e.preventDefault();
	if (commentBusy) return;
	const form = e.target as HTMLFormElement;
	const body = new FormData(form).get("body");
	if (typeof body !== "string" || !body.trim()) return;
	commentBusy = true;
	commentError = false;
	try {
		await client.social.comment({ comicId: detail.id, body: body.trim() });
		form.reset();
		await invalidate((url) => url.pathname === `/comic/${slug}`);
	} catch {
		commentError = true;
	} finally {
		commentBusy = false;
	}
}

// svelte-ignore state_referenced_locally -- initial server state, by design
let rating = $state(data.rating);
const myRating = $derived(rating?.userValue?.toString() ?? "");
let rateBusy = $state(false);
let rateError = $state(false);
async function submitRating(e: Event) {
	const value = Number((e.target as HTMLSelectElement).value);
	if (!Number.isInteger(value) || value < 1 || value > 5) return;
	rateBusy = true;
	rateError = false;
	try {
		rating = await client.social.rate({ comicId: detail.id, value });
	} catch {
		rateError = true;
	} finally {
		rateBusy = false;
	}
}

const REPORT_REASONS = [
	["sexual_content", m.report_reason_sexual_content()],
	["copyright", m.report_reason_copyright()],
	["harassment", m.report_reason_harassment()],
	["spam", m.report_reason_spam()],
	["other", m.report_reason_other()],
] as const;

/** Per-target feedback for report forms: "done" | "already" | "failed". */
let reportMsg = $state<Record<string, "done" | "already" | "failed">>({});
async function submitReport(
	e: SubmitEvent,
	targetType: "comic" | "comment",
	targetId: string,
) {
	e.preventDefault();
	if (reportMsg[targetId] === "done") return;
	const form = e.target as HTMLFormElement;
	const reason = String(new FormData(form).get("reason"));
	try {
		await client.social.report({
			// The server enum-gates this; the select can only produce one of five.
			targetType,
			targetId,
			reason: reason as
				| "sexual_content"
				| "copyright"
				| "harassment"
				| "spam"
				| "other",
		});
		reportMsg[targetId] = "done";
	} catch (error) {
		reportMsg[targetId] =
			(error as { code?: string }).code === "CONFLICT" ? "already" : "failed";
	}
}

const cover = $derived(
	detail.coverUrl ? `${ENV.PUBLIC_SERVER_URL}${detail.coverUrl}` : null,
);
const chapters = $derived(data.chapters);
const firstChapter = $derived(chapters[0] ?? null);

/* ------------------------------------------- creator manage: edit + delete */
let editing = $state(false);
let editBusy = $state(false);
let editMsg = $state<string | null>(null);
let editOk = $state(false);
// svelte-ignore state_referenced_locally -- prefill from server state, by design
let editGenres = $state<Set<Genre>>(new Set(data.comic.genres));

function toggleEditGenre(g: Genre) {
	if (editGenres.has(g)) editGenres.delete(g);
	else editGenres.add(g);
}

async function submitEdit(e: SubmitEvent) {
	e.preventDefault();
	if (editBusy) return;
	const fd = new FormData(e.target as HTMLFormElement);
	editBusy = true;
	editMsg = null;
	try {
		await client.publishing.updateComic({
			comicId: detail.id,
			title: String(fd.get("title") ?? "").trim(),
			synopsis: String(fd.get("synopsis") ?? "").trim() || null,
			genres: [...editGenres],
			visibility: String(fd.get("visibility") ?? "private") as
				| "public"
				| "unlisted"
				| "private",
		});
		editOk = true;
		editing = false;
		// the card text is server truth — re-run the load instead of patching locally
		await invalidate((url) => url.pathname === `/comic/${slug}`);
	} catch (error) {
		editMsg = errorText(mapWriteError(error));
	} finally {
		editBusy = false;
	}
}

let deleteBusy = $state(false);
let deleteMsg = $state<string | null>(null);
async function submitDelete() {
	if (deleteBusy) return;
	if (!confirm(m.manage_delete_confirm())) return;
	deleteBusy = true;
	deleteMsg = null;
	try {
		await client.publishing.deleteComic({ comicId: detail.id });
		await goto("/");
	} catch (error) {
		deleteMsg = errorText(mapWriteError(error));
		deleteBusy = false;
	}
}
</script>

<svelte:head>
	<title>{detail.title} — komik</title>
</svelte:head>

{#snippet reportForm(targetType: "comic" | "comment", targetId: string)}
	{#if signedIn}
		<details class="inline-block text-xs">
			<summary class="cursor-pointer list-none text-text-2 hover:text-accent">
				{m.detail_report()}
			</summary>
			<form
				class="mt-1 flex items-center gap-1"
				onsubmit={(e) => submitReport(e, targetType, targetId)}
			>
				<label class="sr-only" for={`report-${targetId}`}>
					{m.detail_report_reason()}
				</label>
				<select
					id={`report-${targetId}`}
					name="reason"
					class="border border-line bg-bg px-1 py-0.5 text-text-2"
				>
					{#each REPORT_REASONS as [value, label] (value)}
						<option {value}>{label}</option>
					{/each}
				</select>
				<button type="submit" class="border border-line px-2 py-0.5 text-text-2 hover:border-accent hover:text-accent">
					{m.detail_report_submit()}
				</button>
				{#if reportMsg[targetId] === "done"}
					<span class="text-text-2">{m.detail_report_done()}</span>
				{:else if reportMsg[targetId] === "already"}
					<span class="text-text-2">{m.detail_report_already()}</span>
				{:else if reportMsg[targetId] === "failed"}
					<span class="text-accent">{m.error_generic()}</span>
				{/if}
			</form>
		</details>
	{/if}
{/snippet}

{#snippet managePanel()}
	{#if data.canManage}
		<div class="mt-4 border border-line bg-surface p-3">
			<div class="flex flex-wrap items-center gap-2 text-sm">
				<button
					type="button"
					class="border border-line px-3 py-1 font-semibold text-text-2 transition-colors hover:border-accent hover:text-accent"
					onclick={() => {
						editing = !editing;
						editMsg = null;
					}}
				>
					{m.manage_edit()}
				</button>
				<button
					type="button"
					class="border border-line px-3 py-1 font-semibold text-accent transition-colors hover:border-accent disabled:opacity-60"
					onclick={submitDelete}
					disabled={deleteBusy}
				>
					{m.manage_delete()}
				</button>
				{#if editOk}<span class="text-text-2">{m.manage_saved()}</span>{/if}
				{#if deleteMsg}<span class="text-accent" role="alert">{deleteMsg}</span>{/if}
			</div>
			{#if editing}
				<form class="mt-3 space-y-3" onsubmit={submitEdit}>
					<div>
						<label for="edit-title" class="eyebrow">{m.upload_comic_title()}</label>
						<input
							id="edit-title"
							name="title"
							required
							maxlength="200"
							value={detail.title}
							class="mt-1 w-full border border-line bg-bg px-2 py-1.5 text-sm text-ink"
						/>
					</div>
					<div>
						<label for="edit-synopsis" class="eyebrow">{m.upload_comic_synopsis()}</label>
						<textarea
							id="edit-synopsis"
							name="synopsis"
							rows="3"
							maxlength="5000"
							class="mt-1 w-full border border-line bg-bg p-2 text-sm text-ink placeholder:text-decor"
						>{data.synopsis ?? ""}</textarea>
					</div>
					<div>
						<span class="eyebrow">{m.upload_comic_genres()}</span>
						<div class="mt-1 flex flex-wrap gap-1">
							{#each GENRES as g (g)}
								<button
									type="button"
									onclick={() => toggleEditGenre(g)}
									class="border px-1.5 py-0.5 text-[0.65rem] font-semibold tracking-wide uppercase {editGenres.has(g)
										? 'border-accent text-accent'
										: 'border-line text-text-2 hover:border-accent hover:text-accent'}"
								>
									{genreLabel(g)}
								</button>
							{/each}
						</div>
					</div>
					<div>
						<label for="edit-visibility" class="eyebrow">{m.manage_visibility()}</label>
						<select
							id="edit-visibility"
							name="visibility"
							class="mt-1 block w-full border border-line bg-bg px-2 py-1.5 text-sm text-ink"
						>
							<option value="public" selected={detail.visibility === "public"}>
								{m.visibility_public()}
							</option>
							<option value="unlisted" selected={detail.visibility === "unlisted"}>
								{m.visibility_unlisted()}
							</option>
							<option value="private" selected={detail.visibility === "private"}>
								{m.visibility_private()}
							</option>
						</select>
						<p class="mt-1 text-xs text-text-2">{m.manage_visibility_note()}</p>
					</div>
					<div class="flex items-center gap-3">
						<button
							type="submit"
							disabled={editBusy}
							class="bg-accent px-4 py-1.5 text-sm font-semibold text-bg transition-colors hover:bg-accent-dk disabled:opacity-60"
						>
							{m.manage_edit_submit()}
						</button>
						{#if editMsg}<span class="text-xs text-accent" role="alert">{editMsg}</span>{/if}
					</div>
				</form>
			{/if}
		</div>
	{/if}
{/snippet}

<div class="mx-auto max-w-6xl px-4 py-8">
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
			<div class="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
				<p class="text-text-2">{m.detail_by({ name: detail.creator.name })}</p>
				{@render reportForm("comic", detail.id)}
			</div>

			<div class="mt-3 flex flex-wrap gap-1">
				{#each detail.genres as g (g)}
					<span class="border border-line px-1.5 py-0.5 text-[0.65rem] font-semibold tracking-wide text-text-2 uppercase">
						{genreLabel(g)}
					</span>
				{/each}
			</div>

			<p class="mt-4 text-sm text-text-2">
				{#if rating}
					{#if rating.count > 0}
						{m.detail_rating({
							avg: rating.average?.toFixed(1) ?? "–",
							count: rating.count,
						})}
					{:else}
						{m.detail_rating_none()}
					{/if}
				{/if}
			</p>

			{#if signedIn}
				<div class="mt-2 flex flex-wrap items-center gap-2 text-sm">
					<label for="my-rating" class="text-text-2">{m.detail_rate_label()}</label>
					<select
						id="my-rating"
						class="border border-line bg-bg px-2 py-1 text-ink disabled:text-decor"
						value={myRating}
						disabled={rateBusy}
						onchange={submitRating}
					>
						<option value="" disabled>{m.detail_rate_placeholder()}</option>
						{#each [1, 2, 3, 4, 5] as v (v)}
							<option value={String(v)}>{v}</option>
						{/each}
					</select>
					{#if rateError}
						<span class="text-accent">{m.error_generic()}</span>
					{/if}
				</div>
			{/if}

			<div class="mt-4 flex flex-wrap gap-2">
				{#if firstChapter}
					<a
						href="/read/{firstChapter.id}"
						class="bg-accent px-5 py-2 text-sm font-semibold text-bg transition-colors hover:bg-accent-dk"
					>
						{m.detail_read_first()}
					</a>
				{/if}
				{#if signedIn}
					<button
						type="button"
						onclick={toggleSave}
						disabled={saving}
						class="border px-5 py-2 text-sm font-semibold transition-colors disabled:opacity-60 {saved
							? 'border-accent text-accent'
							: 'border-line text-text-2 hover:border-accent hover:text-accent'}"
					>
						{saved ? m.detail_saved() : m.detail_save()}
					</button>
					{#if saveError}
						<span
							class="self-center text-xs text-accent"
							role="alert"
						>{m.error_generic()}</span>
					{/if}
					<button
						type="button"
						onclick={toggleFollow}
						disabled={followingBusy}
						class="border px-5 py-2 text-sm font-semibold transition-colors disabled:opacity-60 {following
							? 'border-accent text-accent'
							: 'border-line text-text-2 hover:border-accent hover:text-accent'}"
					>
						{following ? m.detail_following() : m.detail_follow()}
					</button>
					{#if followError}
						<span
							class="self-center text-xs text-accent"
							role="alert"
						>{m.error_generic()}</span>
					{/if}
				{:else}
					<span class="self-center text-xs text-text-2">{m.detail_save_unavailable()}</span>
					<span class="self-center text-xs text-text-2">{m.detail_follow_unavailable()}</span>
				{/if}
			</div>

			{@render managePanel()}

			<section class="mt-8">
				<h2 class="eyebrow">{m.detail_synopsis()}</h2>
				<p class="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink">
					{data.synopsis || m.detail_no_synopsis()}
				</p>
			</section>
		</div>
	</div>

	<section class="mt-10">
		<div class="flex items-baseline justify-between gap-4">
			<h2 class="eyebrow">{m.detail_chapters()}</h2>
			{#if data.canManage}
				<!-- Owner/admin entry point into the upload flow's step 2 -->
				<a
					href="/upload?comic={detail.id}"
					class="text-sm font-semibold text-accent hover:underline"
				>
					{m.detail_add_chapter()}
				</a>
			{/if}
		</div>
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
		{#if signedIn}
			<form class="mt-3 space-y-2" onsubmit={submitComment}>
				<label class="sr-only" for="comment-body">{m.detail_comments()}</label>
				<textarea
					id="comment-body"
					name="body"
					rows="3"
					required
					maxlength="2000"
					class="w-full border border-line bg-bg p-2 text-sm text-ink placeholder:text-decor"
					placeholder={m.detail_comment_placeholder()}
				></textarea>
				<div class="flex items-center gap-3">
					<button
						type="submit"
						disabled={commentBusy}
						class="border border-line px-4 py-1.5 text-sm font-semibold text-text-2 transition-colors hover:border-accent hover:text-accent disabled:opacity-60"
					>
						{m.detail_comment_submit()}
					</button>
					{#if commentError}
						<span class="text-xs text-accent" role="alert">{m.error_generic()}</span>
					{/if}
				</div>
			</form>
		{:else}
			<!-- The list below still renders — reads are public; the form is what a
			     signed-out visitor lacks. -->
			<p class="mt-2 text-sm text-text-2">
				<a href="/login" class="text-accent hover:underline">{m.detail_comments_signin_prompt()}</a>
			</p>
		{/if}
		{#if !data.comments || data.comments.items.length === 0}
			<p class="mt-2 text-sm text-text-2">{m.detail_comments_empty()}</p>
		{:else}
			<ul class="mt-4 space-y-4 border-t border-line pt-4">
				{#each data.comments.items as c (c.id)}
					<li class="text-sm">
						<div class="flex flex-wrap items-baseline gap-x-3">
							<p class="font-semibold text-ink">{c.author.name}</p>
							{@render reportForm("comment", c.id)}
						</div>
						<p class="mt-0.5 whitespace-pre-line text-ink">{c.body}</p>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>
