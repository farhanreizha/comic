<script lang="ts">
import DetailSkeleton from "$components/DetailSkeleton.svelte";
import type { PageData } from "./$types";
import Detail from "./Detail.svelte";

// Issue #42: comic + chapters (data.comic) are awaited so 404/403 survive;
// the shelf/rating/comments bundle (data.aux) streams in behind
// DetailSkeleton. Detail is mounted only once aux resolves, so the merged
// prop keeps Detail's old `data.saved`-style reads intact.
let { data }: { data: PageData } = $props();

const merged = $derived(data.aux.then((aux) => ({ ...data, ...aux })));
</script>

{#await merged}
	<DetailSkeleton />
{:then full}
	<Detail data={full} />
{:catch}
	<!-- aux catches every call internally; unreachable in practice. -->
	<Detail data={data} />
{/await}
