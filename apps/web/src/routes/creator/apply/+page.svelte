<script lang="ts">
	import { invalidate } from "$app/navigation";
	import { client } from "$lib/orpc";
	import { errorText, mapWriteError } from "$lib/write-ui";
	import { m } from "$paraglide/messages.js";

	let { data } = $props();

	let submitting = $state(false);
	let msg = $state<string | null>(null);
	// svelte-ignore state_referenced_locally -- initial server state, by design
	let application = $state(data.application);

	const statusCopy: Record<string, () => string> = {
		pending: m.apply_status_pending,
		approved: m.apply_status_approved,
		rejected: m.apply_status_rejected,
	};

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (submitting) return;
		const form = e.target as HTMLFormElement;
		const fd = new FormData(form);
		const motivation = String(fd.get("motivation") ?? "").trim();
		if (!motivation) return;
		const portfolioUrl = String(fd.get("portfolioUrl") ?? "").trim();
		const sample = fd.get("sample") as File | null;

		submitting = true;
		msg = null;
		try {
			application = await client.admin.applyForCreator({
				motivation,
				portfolioUrl: portfolioUrl || undefined,
				sample: sample && sample.size > 0 ? sample : undefined,
			});
			form.reset();
		} catch (error) {
			const code = (error as { code?: string }).code;
			if (code === "CONFLICT") {
				// already pending is a state, not an error — refresh the card
				msg = m.apply_pending_note();
				await invalidate((url) => url.pathname === "/creator/apply");
			} else {
				msg = errorText(mapWriteError(error));
			}
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head>
	<title>{m.apply_title()} — komik</title>
</svelte:head>

<div class="mx-auto max-w-2xl px-4 py-8">
	<h1 class="font-display text-3xl font-bold text-ink">{m.apply_title()}</h1>

	{#if data.gate === "anonymous"}
		<p class="mt-4 text-sm text-text-2">
			<a href="/login" class="text-accent hover:underline">{m.apply_signin_prompt()}</a>
		</p>
	{:else if data.gate === "creator"}
		<p class="mt-4 text-sm text-ink">
			{m.apply_already_creator()}
			<a href="/upload" class="text-accent hover:underline">{m.upload_title()}</a>
		</p>
	{:else}
		{#if application && statusCopy[application.status]}
			<!-- Current application state: a card, not an error. -->
			<div class="mt-4 border border-line bg-surface/30 p-4 text-sm text-ink">
				<p class="font-semibold">{m.apply_status_label({ status: application.status })}</p>
				<p class="mt-1">{statusCopy[application.status]()}</p>
			</div>
		{/if}

		{#if !application || application.status === "rejected"}
			<form class="mt-6 space-y-4" onsubmit={submit}>
				<div>
					<label for="motivation" class="block text-sm font-semibold text-ink">
						{m.apply_motivation()}
					</label>
					<textarea
						id="motivation"
						name="motivation"
						rows="4"
						required
						maxlength="5000"
						class="mt-1 w-full border border-line bg-bg p-2 text-sm text-ink"
						placeholder={m.apply_motivation_placeholder()}
					></textarea>
				</div>
				<div>
					<label for="portfolio" class="block text-sm font-semibold text-ink">
						{m.apply_portfolio()}
					</label>
					<input
						id="portfolio"
						name="portfolioUrl"
						type="url"
						maxlength="2000"
						class="mt-1 w-full border border-line bg-bg p-2 text-sm text-ink"
					/>
				</div>
				<div>
					<label for="sample" class="block text-sm font-semibold text-ink">
						{m.apply_sample()}
					</label>
					<input
						id="sample"
						name="sample"
						type="file"
						accept="image/*,.pdf"
						class="mt-1 block max-w-full text-sm text-text-2"
					/>
				</div>
				<div class="flex items-center gap-3">
					<button
						type="submit"
						disabled={submitting}
						class="bg-accent px-5 py-2 text-sm font-semibold text-bg transition-colors hover:bg-accent-dk disabled:opacity-60"
					>
						{m.apply_submit()}
					</button>
					{#if msg}
						<span class="text-sm {application ? 'text-text-2' : 'text-accent'}" role={application ? 'status' : 'alert'}>{msg}</span>
					{/if}
				</div>
			</form>
		{/if}
	{/if}
</div>
