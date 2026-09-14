import { derived } from "svelte/store";
import { browser } from "$app/environment";

const KEY = "comic.shelf";

function read(): string[] {
	if (!browser) return [];
	try {
		const raw = localStorage.getItem(KEY);
		return raw ? (JSON.parse(raw) as string[]) : [];
	} catch {
		return [];
	}
}

/** Local-only shelf until the backend grows a save/unsave entry point. */
function makeShelf() {
	let ids = read();
	const listeners = new Set<(v: string[]) => void>();
	const emit = () =>
		listeners.forEach((l) => {
			l(ids);
		});
	return {
		subscribe(run: (v: string[]) => void) {
			listeners.add(run);
			run(ids);
			return () => listeners.delete(run);
		},
		toggle(comicId: string) {
			ids = ids.includes(comicId)
				? ids.filter((id) => id !== comicId)
				: [...ids, comicId];
			if (browser) localStorage.setItem(KEY, JSON.stringify(ids));
			emit();
		},
	};
}

export const shelf = makeShelf();
export const isSaved = (comicId: string) =>
	derived(shelf, ($s: string[]) => $s.includes(comicId));
