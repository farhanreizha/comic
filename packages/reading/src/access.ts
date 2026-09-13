import type {
	ChapterRecord,
	ChapterSummary,
	ComicCard,
	ComicRecord,
	PageRecord,
	Viewer,
	VisibilityScope,
} from "./types";

/**
 * Invariant 4, the single access decision. Every read path funnels here.
 *
 * | visibility | status    | anon          | reader | owner | admin |
 * | public     | published | read          | read   | read  | read  |
 * | public     | draft     | —             | —      | read  | read  |
 * | unlisted   | published | read by ref   | read   | read  | read  |
 * | unlisted   | draft     | —             | —      | read  | read  |
 * | private    | *         | —             | —      | read  | read  |
 *
 * Takedown overrides all of it (social-admin.md invariant 3): a taken-down
 * comic fails for everyone except admin — including its owner. The one and
 * only home of that rule.
 */
export function canView(viewer: Viewer, comic: ComicRecord): boolean {
	if (
		viewer.kind === "user" &&
		(viewer.role === "admin" || viewer.id === comic.creatorId)
	) {
		return comic.takenDownAt === null || viewer.role === "admin";
	}
	return (
		comic.takenDownAt === null &&
		comic.status === "published" &&
		comic.visibility !== "private"
	);
}

/**
 * Invariant 2: what `browse` may return — canView AND (public OR owns OR admin).
 * Kept separate from canView on purpose: unlisted published comics are readable
 * by ref but never listed for a non-owner.
 */
export function browseVisible(viewer: Viewer, comic: ComicRecord): boolean {
	if (!canView(viewer, comic)) return false;
	if (comic.visibility === "public") return true;
	return (
		viewer.kind === "user" &&
		(viewer.id === comic.creatorId || viewer.role === "admin")
	);
}

/** DB-side scope for `listComics`; browseVisible stays the source of truth. */
export function scopeFor(viewer: Viewer): VisibilityScope {
	if (viewer.kind === "anonymous") return { kind: "publicPublished" };
	if (viewer.role === "admin") return { kind: "all" };
	return { kind: "publicPublishedOrOwned", userId: viewer.id };
}

export function toCard(comic: ComicRecord): ComicCard {
	return {
		id: comic.id,
		slug: comic.slug,
		title: comic.title,
		coverUrl: comic.coverUrl,
		creator: { id: comic.creatorId, name: comic.creatorName },
		genres: comic.genres,
		chapterCount: comic.chapterCount,
		visibility: comic.visibility,
		status: comic.status,
		updatedAt: comic.updatedAt,
	};
}

export function toSummary(chapter: ChapterRecord): ChapterSummary {
	return {
		id: chapter.id,
		comicId: chapter.comicId,
		ordinal: chapter.ordinal,
		title: chapter.title,
		pageCount: chapter.pageCount,
	};
}

export function toPageSummary(page: PageRecord): {
	id: string;
	number: number;
} {
	return { id: page.id, number: page.number };
}
