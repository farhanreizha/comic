<script lang="ts">
import { QueryClientProvider } from "@tanstack/svelte-query";
import { page } from "$app/state";
import "../app.css";
import Footer from "$components/Footer.svelte";
import Header from "$components/Header.svelte";
import LocaleSwitcher from "$components/LocaleSwitcher.svelte";
import ProgressRail from "$components/ProgressRail.svelte";
import UserMenu from "$components/UserMenu.svelte";
import { queryClient } from "$lib/orpc";

const { children, data } = $props();

// The reader wears its own chrome — keep the app header off that route.
const inReader = $derived(page.url.pathname.startsWith("/read/"));
</script>

<QueryClientProvider client={queryClient}>
	{#if inReader}
		{@render children()}
	{:else}
		<!-- grid-cols minmax(0,1fr) + min-w-0 items: the implicit auto grid track
		     otherwise stretches to header/main min-content and inflates the whole
		     page past the viewport (BUG-2). -->
		<div class="grid min-h-svh grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr_auto]">
			<Header role={data.role} signedIn={data.signedIn} />
			<main class="min-w-0">
				{@render children()}
			</main>
			<Footer />
		</div>
	{/if}
	<ProgressRail />
</QueryClientProvider>
