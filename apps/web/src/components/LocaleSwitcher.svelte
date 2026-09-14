<script lang="ts">
	import { getLocale, locales, setLocale } from "$paraglide/runtime.js";
	import { m } from "$paraglide/messages.js";

	function pick(locale: (typeof locales)[number]) {
		// Default reload: a full document navigation so SSR text follows the
		// cookie. `goto` has no `force` option in this Kit version.
		void setLocale(locale);
	}
</script>

<div
	class="flex items-center gap-1 rounded border border-line px-1"
	role="group"
	aria-label={m.locale_switcher()}
>
	{#each locales as locale}
		<button
			type="button"
			class="px-1.5 py-0.5 text-xs font-bold tracking-wide uppercase {getLocale() ===
			locale
				? 'bg-accent text-bg'
				: 'text-text-2 hover:text-ink'}"
			aria-pressed={getLocale() === locale}
			onclick={() => pick(locale)}
		>
			{locale}
		</button>
	{/each}
</div>
