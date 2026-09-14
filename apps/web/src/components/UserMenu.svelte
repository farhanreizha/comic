<script lang="ts">
	import { goto, invalidateAll } from "$app/navigation";
	import { authClient } from "$lib/auth-client";
	import { m } from "$paraglide/messages.js";

	/**
	 * `signedIn` is the server's answer, so the auth controls are correct in the
	 * first paint. The session query only supplies the display name once the
	 * client hydrates — it never decides which variant renders.
	 */
	let { signedIn = false }: { signedIn?: boolean } = $props();

	const sessionQuery = authClient.useSession();

	async function handleSignOut() {
		await authClient.signOut({
			fetchOptions: {
				onSuccess: async () => {
					await invalidateAll();
					goto("/");
				},
				onError: (error) => {
					console.error("Sign out failed:", error);
				},
			},
		});
	}
</script>

{#if signedIn}
	<div class="flex items-center gap-2">
		<span class="hidden text-sm text-text-2 sm:inline" title={$sessionQuery.data?.user.email}>
			{$sessionQuery.data?.user.name || $sessionQuery.data?.user.email?.split("@")[0] || ""}
		</span>
		<button
			onclick={handleSignOut}
			class="rounded border border-line px-3 py-1 text-sm font-semibold text-accent hover:bg-accent hover:text-bg transition-colors"
		>
			{m.nav_signout()}
		</button>
	</div>
{:else}
	<div class="flex items-center gap-2">
		<a
			href="/login"
			class="rounded border border-line px-3 py-1 text-sm font-semibold text-text-2 hover:text-ink transition-colors"
		>
			{m.nav_signin()}
		</a>
		<a
			href="/login?mode=signup"
			class="rounded bg-accent px-3 py-1 text-sm font-semibold text-bg transition-colors hover:bg-accent-dk"
		>
			{m.nav_signup()}
		</a>
	</div>
{/if}
