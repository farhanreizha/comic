<script lang="ts">
	import { client } from "$lib/orpc";
	import { errorText, mapWriteError } from "$lib/write-ui";
	import { m } from "$paraglide/messages.js";
	import { ENV } from "../../varlock-env";

	let { data } = $props();

	type DecisionState = "approved" | "rejected" | "already" | "failed";
	let decisions = $state<Record<string, DecisionState>>({});
	let decisionBusy = $state<string | null>(null);

	// `data` is a plain prop object — mutating `data.applications` never
	// triggers a re-render. Hide decided rows via derived state instead.
	let hiddenAppIds = $state<Set<string>>(new Set());
	let hiddenReportIds = $state<Set<string>>(new Set());
	const applications = $derived((data.applications ?? []).filter((a) => !hiddenAppIds.has(a.id)));
	const reports = $derived((data.reports ?? []).filter((r) => !hiddenReportIds.has(r.id)));

	async function decide(id: string, decision: "approve" | "reject") {
		if (decisionBusy) return;
		decisionBusy = id;
		try {
			await client.admin.decideApplication({ id, decision });
			decisions[id] = decision === "approve" ? "approved" : "rejected";
			hiddenAppIds = new Set([...hiddenAppIds, id]);
		} catch (error) {
			const code = (error as { code?: string }).code;
			decisions[id] = code === "CONFLICT" ? "already" : "failed";
		} finally {
			decisionBusy = null;
		}
	}

	type ResolveState = "done" | "already" | "failed";
	let resolves = $state<Record<string, ResolveState>>({});
	let resolveBusy = $state<string | null>(null);

	async function resolve(id: string, action: "hide_comment" | "take_down_comic" | "dismiss") {
		if (resolveBusy) return;
		resolveBusy = id;
		try {
			await client.admin.resolveReport({ id, action });
			resolves[id] = "done";
			hiddenReportIds = new Set([...hiddenReportIds, id]);
		} catch (error) {
			const code = (error as { code?: string }).code;
			resolves[id] = code === "CONFLICT" ? "already" : "failed";
		} finally {
			resolveBusy = null;
		}
	}

	const REPORT_REASONS: Record<string, () => string> = {
		sexual_content: m.report_reason_sexual_content,
		copyright: m.report_reason_copyright,
		harassment: m.report_reason_harassment,
		spam: m.report_reason_spam,
		other: m.report_reason_other,
	};

	/* takedown panel */
	let takedownComic = $state("");
	let takedownReason = $state("");
	let takedownBusy = $state(false);
	let takedownMsg = $state<string | null>(null);
	let takedownOk = $state(false);

	async function setTakedown(takenDown: boolean) {
		if (takedownBusy || !takedownComic) return;
		takedownBusy = true;
		takedownMsg = null;
		takedownOk = false;
		try {
			await client.admin.setTakedown({
				comicId: takedownComic,
				takenDown,
				reason: takenDown && takedownReason.trim() ? takedownReason.trim() : undefined,
			});
			takedownOk = true;
			takedownReason = "";
		} catch (error) {
			takedownMsg = errorText(mapWriteError(error));
		} finally {
			takedownBusy = false;
		}
	}

	/* suspend panel — user-level moderation; comics stay under takedown */
	let suspendUser = $state("");
	let suspendReason = $state("");
	let suspendBusy = $state(false);
	let suspendMsg = $state<string | null>(null);
	let suspendOk = $state(false);

	async function setSuspend(suspended: boolean) {
		if (suspendBusy || !suspendUser) return;
		suspendBusy = true;
		suspendMsg = null;
		suspendOk = false;
		try {
			if (suspended) {
				await client.admin.suspendUser({
					userId: suspendUser,
					reason: suspendReason.trim() ? suspendReason.trim() : undefined,
				});
			} else {
				await client.admin.unsuspendUser({ userId: suspendUser });
			}
			suspendOk = true;
			suspendReason = "";
		} catch (error) {
			suspendMsg = errorText(mapWriteError(error));
		} finally {
			suspendBusy = false;
		}
	}
</script>

<svelte:head>
	<title>{m.admin_title()} — komik</title>
</svelte:head>

<div class="mx-auto max-w-5xl px-4 py-8">
	<h1 class="font-display text-3xl font-bold text-ink">{m.admin_title()}</h1>

	{#if data.gate !== "admin"}
		<!-- Role gate tripped in the load: honest page, not a blank or a 500. -->
		<p class="mt-4 text-sm text-ink">{m.admin_denied()}</p>
		<a href="/" class="mt-2 inline-flex min-h-7 items-center text-sm text-accent hover:underline">
			{m.admin_denied_home()}
		</a>
	{:else}
		<!-- Applications queue -->
		<section class="mt-8">
			<h2 class="eyebrow">{m.admin_apps_heading()}</h2>
			{#if !data.applications}
				<p class="mt-2 text-sm text-accent" role="alert">{m.admin_load_failed()}</p>
			{:else if applications.length === 0}
				<p class="mt-2 text-sm text-text-2">{m.admin_apps_empty()}</p>
			{:else}
				<ul class="mt-3 space-y-4">
					{#each applications as a (a.id)}
						<li class="border border-line bg-bg p-4 text-sm">
							<p class="font-semibold text-ink">{a.applicant.name}</p>
							<p class="mt-1 whitespace-pre-line text-ink">{a.motivation}</p>
							<div class="mt-2 flex flex-wrap items-center gap-3 text-text-2">
								{#if a.portfolioUrl}
									<a href={a.portfolioUrl} target="_blank" rel="noopener noreferrer" class="inline-flex min-h-7 items-center text-accent hover:underline">
										{m.admin_apps_portfolio()}
									</a>
								{/if}
								{#if a.sampleKey}
									<a
										href="{ENV.PUBLIC_SERVER_URL}/admin/applications/{a.id}/sample"
										class="inline-flex min-h-7 items-center text-accent hover:underline"
									>
										{m.admin_apps_sample()}
									</a>
								{/if}
							</div>
							<div class="mt-3 flex items-center gap-2">
								<button
									type="button"
									disabled={decisionBusy === a.id}
									onclick={() => decide(a.id, "approve")}
									class="bg-accent px-4 py-1.5 text-xs font-semibold text-bg transition-colors hover:bg-accent-dk disabled:opacity-60"
								>
									{m.admin_approve()}
								</button>
								<button
									type="button"
									disabled={decisionBusy === a.id}
									onclick={() => decide(a.id, "reject")}
									class="border border-line px-4 py-1.5 text-xs font-semibold text-text-2 transition-colors hover:border-accent hover:text-accent disabled:opacity-60"
								>
									{m.admin_reject()}
								</button>
								{#if decisions[a.id] === "already"}
									<span class="text-xs text-text-2">{m.admin_decided()}</span>
								{:else if decisions[a.id] === "failed"}
									<span class="text-xs text-accent" role="alert">{m.admin_decide_failed()}</span>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<!-- Reports queue -->
		<section class="mt-10">
			<h2 class="eyebrow">{m.admin_reports_heading()}</h2>
			{#if !data.reports}
				<p class="mt-2 text-sm text-accent" role="alert">{m.admin_load_failed()}</p>
			{:else if reports.length === 0}
				<p class="mt-2 text-sm text-text-2">{m.admin_reports_empty()}</p>
			{:else}
				<ul class="mt-3 space-y-4">
					{#each reports as r (r.id)}
						<li class="border border-line bg-bg p-4 text-sm">
							<p class="font-semibold text-ink">
								{r.targetType} · {REPORT_REASONS[r.reason]?.() ?? r.reason}
							</p>
							{#if r.note}
								<p class="mt-1 whitespace-pre-line text-text-2">{r.note}</p>
							{/if}
							<p class="mt-1 text-xs text-text-2">
								{m.admin_reports_target()}: {r.targetId}
							</p>
							<div class="mt-3 flex flex-wrap items-center gap-2">
								{#if r.targetType === "comment"}
									<button
										type="button"
										disabled={resolveBusy === r.id}
										onclick={() => resolve(r.id, "hide_comment")}
										class="border border-line px-3 py-2 text-xs font-semibold text-text-2 hover:border-accent hover:text-accent disabled:opacity-60"
									>
										{m.admin_hide_comment()}
									</button>
								{:else}
									<button
										type="button"
										disabled={resolveBusy === r.id}
										onclick={() => resolve(r.id, "take_down_comic")}
										class="bg-accent px-3 py-2 text-xs font-semibold text-bg hover:bg-accent-dk disabled:opacity-60"
									>
										{m.admin_take_down()}
									</button>
								{/if}
								<button
									type="button"
									disabled={resolveBusy === r.id}
									onclick={() => resolve(r.id, "dismiss")}
									class="border border-line px-3 py-2 text-xs font-semibold text-text-2 hover:border-accent hover:text-accent disabled:opacity-60"
								>
									{m.admin_dismiss()}
								</button>
								{#if resolves[r.id] === "already"}
									<span class="text-xs text-text-2">{m.admin_report_resolved()}</span>
								{:else if resolves[r.id] === "failed"}
									<span class="text-xs text-accent" role="alert">{m.admin_decide_failed()}</span>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<!-- User suspend -->
		<section class="mt-10">
			<h2 class="eyebrow">{m.admin_suspend_heading()}</h2>
			<p class="mt-2 text-xs text-text-2">{m.admin_suspend_warning()}</p>
			<div class="mt-3 flex flex-wrap items-end gap-3 text-sm">
				<div class="min-w-56 flex-1">
					<label for="suspend-user" class="block font-semibold text-ink">
						{m.admin_suspend_user_id()}
					</label>
					<input
						id="suspend-user"
						type="text"
						class="mt-1 w-full border border-line bg-bg p-2 text-ink"
						bind:value={suspendUser}
					/>
				</div>
				<div class="min-w-56 flex-1">
					<label for="suspend-reason" class="block font-semibold text-ink">
						{m.admin_suspend_reason_label()}
					</label>
					<input
						id="suspend-reason"
						type="text"
						maxlength="2000"
						class="mt-1 w-full border border-line bg-bg p-2 text-ink"
						bind:value={suspendReason}
					/>
				</div>
				<button
					type="button"
					disabled={suspendBusy || !suspendUser}
					onclick={() => setSuspend(true)}
					class="bg-accent px-4 py-2 text-xs font-semibold text-bg hover:bg-accent-dk disabled:opacity-60"
				>
					{m.admin_suspend_on()}
				</button>
				<button
					type="button"
					disabled={suspendBusy || !suspendUser}
					onclick={() => setSuspend(false)}
					class="border border-line px-4 py-2 text-xs font-semibold text-text-2 hover:border-accent hover:text-accent disabled:opacity-60"
				>
					{m.admin_unsuspend()}
				</button>
			</div>
			{#if suspendOk}
				<p class="mt-2 text-sm text-text-2">{m.admin_suspend_done()}</p>
			{/if}
			{#if suspendMsg}
				<p class="mt-2 text-sm text-accent" role="alert">{suspendMsg}</p>
			{/if}
		</section>

		<!-- Manual takedown -->
		<section class="mt-10">
			<h2 class="eyebrow">{m.admin_takedown_heading()}</h2>
			{#if !data.comics}
				<p class="mt-2 text-sm text-accent" role="alert">{m.admin_load_failed()}</p>
			{:else}
				<p class="mt-2 text-xs text-text-2">{m.admin_takedown_warning()}</p>
				<div class="mt-3 flex flex-wrap items-end gap-3 text-sm">
					<div class="min-w-56 flex-1">
						<label for="takedown-comic" class="block font-semibold text-ink">
							{m.admin_takedown_comic_id()}
						</label>
						<select
							id="takedown-comic"
							class="mt-1 w-full border border-line bg-bg p-2 text-ink"
							bind:value={takedownComic}
						>
							<option value="">—</option>
							{#each data.comics as c (c.id)}
								<option value={c.id}>{c.title} ({c.creator.name})</option>
							{/each}
						</select>
					</div>
					<div class="min-w-56 flex-1">
						<label for="takedown-reason" class="block font-semibold text-ink">
							{m.admin_takedown_reason_label()}
						</label>
						<input
							id="takedown-reason"
							type="text"
							maxlength="2000"
							class="mt-1 w-full border border-line bg-bg p-2 text-ink"
							bind:value={takedownReason}
						/>
					</div>
					<button
						type="button"
						disabled={takedownBusy || !takedownComic}
						onclick={() => setTakedown(true)}
						class="bg-accent px-4 py-2 text-xs font-semibold text-bg hover:bg-accent-dk disabled:opacity-60"
					>
						{m.admin_takedown_on()}
					</button>
					<button
						type="button"
						disabled={takedownBusy || !takedownComic}
						onclick={() => setTakedown(false)}
						class="border border-line px-4 py-2 text-xs font-semibold text-text-2 hover:border-accent hover:text-accent disabled:opacity-60"
					>
						{m.admin_takedown_off()}
					</button>
				</div>
				{#if takedownOk}
					<p class="mt-2 text-sm text-text-2">{m.admin_takedown_done()}</p>
				{/if}
				{#if takedownMsg}
					<p class="mt-2 text-sm text-accent" role="alert">{takedownMsg}</p>
				{/if}
			{/if}
		</section>
	{/if}
</div>
