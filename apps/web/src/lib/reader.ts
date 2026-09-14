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
