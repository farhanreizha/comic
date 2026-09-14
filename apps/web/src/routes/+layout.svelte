<script lang="ts">
	import { QueryClientProvider } from "@tanstack/svelte-query";
	import { page } from "$app/state";
	import "../app.css";
	import { queryClient } from "$lib/orpc";
	import Header from "$components/Header.svelte";
	import Footer from "$components/Footer.svelte";
	import UserMenu from "$components/UserMenu.svelte";
	import LocaleSwitcher from "$components/LocaleSwitcher.svelte";

	const { children } = $props();

	// The reader wears its own chrome — keep the app header off that route.
	const inReader = $derived(page.url.pathname.startsWith("/read/"));
</script>

<QueryClientProvider client={queryClient}>
	{#if inReader}
		{@render children()}
	{:else}
		<div class="grid min-h-svh grid-rows-[auto_1fr_auto]">
			<Header />
			<main>
				{@render children()}
			</main>
			<Footer />
		</div>
	{/if}
</QueryClientProvider>
