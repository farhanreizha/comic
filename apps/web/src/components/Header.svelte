<script lang="ts">
	import { m } from "$paraglide/messages.js";
	import LocaleSwitcher from "./LocaleSwitcher.svelte";
	import UserMenu from "./UserMenu.svelte";

	/**
	 * Role comes from the layout's server load, not a client query: the nav is
	 * chrome and must be correct in the first paint (and visible to crawlers).
	 */
	let { role = null, signedIn = false }: { role?: string | null; signedIn?: boolean } =
		$props();
</script>

<header class="sticky top-0 z-40 border-b border-line bg-bg/95 backdrop-blur">
	<div
		class="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
	>
		<a href="/" class="font-display text-2xl font-bold tracking-tight text-ink">
			komi<span class="text-accent">k</span>
		</a>
		<nav class="order-3 -mx-1 w-full overflow-x-auto sm:order-none sm:w-auto sm:overflow-visible" aria-label="main">
			<ul class="flex items-center gap-1 text-sm whitespace-nowrap">
				<li><a href="/" class="rounded px-2.5 py-1.5 font-semibold text-text-2 hover:bg-surface/60 hover:text-ink">{m.nav_browse()}</a></li>
				<li><a href="/?focus=search" class="rounded px-2.5 py-1.5 font-semibold text-text-2 hover:bg-surface/60 hover:text-ink">{m.nav_search()}</a></li>
				{#if signedIn}
					<li><a href="/library" class="rounded px-2.5 py-1.5 font-semibold text-text-2 hover:bg-surface/60 hover:text-ink">{m.nav_library()}</a></li>
				{/if}
				{#if role === "creator" || role === "admin"}
					<li><a href="/upload" class="rounded px-2.5 py-1.5 font-semibold text-text-2 hover:bg-surface/60 hover:text-ink">{m.nav_upload()}</a></li>
				{/if}
				{#if role === "admin"}
					<li><a href="/admin" class="rounded px-2.5 py-1.5 font-semibold text-text-2 hover:bg-surface/60 hover:text-ink">{m.nav_admin()}</a></li>
				{/if}
			</ul>
		</nav>
		<div class="ml-auto flex items-center gap-2">
			<LocaleSwitcher />
			<UserMenu {signedIn} />
		</div>
	</div>
</header>
