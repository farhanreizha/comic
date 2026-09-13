/** Minted ids + slugs. Storage keys embed the chapter id, so ids are minted
 * by the module before any write (invariants 4/5). Prisma declares the same
 * @default(cuid()) columns; an explicit value always wins. */

import { randomUUID } from "node:crypto";

export const newId = (): string => randomUUID();

const SLUG_MAX = 96;

/** URL-safe slug from a title; "" when the title has no slug chars. */
export function slugify(title: string): string {
	const slug = title
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, SLUG_MAX)
		.replace(/-+$/g, "");
	return slug;
}

/** First free variant of a slug: base, base-2, base-3, … (36-radix counter). */
export async function variantSlug(
	base: string,
	taken: (s: string) => Promise<boolean>,
): Promise<string> {
	if (!(await taken(base))) return base;
	for (let n = 2; n < 46_656; n++) {
		const candidate = `${base}-${n.toString(36)}`;
		if (!(await taken(candidate))) return candidate;
	}
	return `${base}-${randomUUID().slice(0, 8)}`;
}
