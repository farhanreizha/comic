/** Clamp a user-entered page to a valid 1-based index. NaN-ish input -> 1. */
export function clampPage(n: number, total: number): number {
	if (!Number.isFinite(n)) return 1;
	return Math.min(Math.max(1, Math.round(n)), total);
}
/** Pure page-window math for the reader's lazy strip. Unit-tested, SSR-safe. */
export function activeWindow(
	current: number,
	total: number,
	window: number,
): [number, number] {
	const start = Math.max(1, current - window);
	const end = Math.min(total, current + window);
	return [start, end];
}
