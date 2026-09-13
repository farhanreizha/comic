/**
 * Archive reading — INTERNAL SEAM, not a port (docs/design/write-path.md).
 * One dependency (fflate), one implementation; it becomes a port the day a
 * second real format (CBR) has a caller. No decoder registry.
 */

import { Unzip, type UnzipFile, UnzipInflate } from "fflate";
import {
	MAX_ARCHIVE_ENTRIES,
	MAX_CHAPTER_BYTES,
	MAX_IMAGE_BYTES,
	publishingError,
} from "./types";

export type ExtractedEntry = {
	name: string;
	bytes: Uint8Array;
	/** True when the entry ballooned past the per-entry guard; `bytes` then
	 * holds a sniffable 64-byte prefix, and an image entry must be rejected. */
	oversized: boolean;
};

// Entries larger than this can never become a page (MAX_IMAGE_BYTES caps
// images) — capture only a sniffing prefix and stop accumulating.
const PER_ENTRY_CAP = MAX_IMAGE_BYTES + 64;

/**
 * Decompress every entry of a ZIP/CBZ, enforcing the archive-entry limit and
 * size guards *during* extraction: an archive that expands past
 * MAX_CHAPTER_BYTES total, or an entry past the per-entry cap, fails before
 * anything is written. Parse failures reject with INVALID_INPUT.
 */
export function extractArchive(
	uploadBytes: Uint8Array,
	filename: string,
): Promise<ExtractedEntry[]> {
	return new Promise((resolve, reject) => {
		// A ZIP without its End Of Central Directory record (signature
		// 'PK\x05\x06' in the last 64 KB) is a truncated archive, not a
		// streamable one — reject up front (invariant 11).
		if (!hasEOCD(uploadBytes)) {
			reject(
				publishingError(
					"INVALID_INPUT",
					"archive is truncated or missing its central directory",
					filename,
				),
			);
			return;
		}
		const entries: ExtractedEntry[] = [];
		let settled = false;
		let total = 0;
		let started = 0;
		let finished = 0;
		let errored = 0;
		let pushedDone = false;

		const fail = (
			code: "INVALID_INPUT" | "TOO_LARGE" | "LIMIT_EXCEEDED",
			detail: string,
			at?: string,
		) => {
			if (settled) return;
			settled = true;
			reject(publishingError(code, detail, at ?? filename));
		};
		const maybeDone = () => {
			if (settled || !pushedDone) return;
			if (errored > 0) {
				fail("INVALID_INPUT", "corrupt archive");
			} else if (started === finished) {
				settled = true;
				resolve(entries);
			}
		};

		let unz: Unzip;
		try {
			unz = new Unzip((file: UnzipFile) => {
				if (settled) return;
				if (file.name.endsWith("/")) return; // directories carry no bytes
				started++;
				if (started > MAX_ARCHIVE_ENTRIES) {
					finished++;
					fail(
						"LIMIT_EXCEEDED",
						`archive has more than ${MAX_ARCHIVE_ENTRIES} entries`,
					);
					return;
				}
				const chunks: Uint8Array[] = [];
				let size = 0;
				let oversized = false;
				let head: Uint8Array | null = null;
				file.ondata = (err, data, final) => {
					if (settled) return;
					if (err) {
						started--; // never a completable entry
						errored++;
						fail("INVALID_INPUT", `corrupt archive: ${err.message}`);
						return;
					}
					if (head === null) head = data.slice(0, 64);
					size += data.length;
					total += data.length;
					if (total > MAX_CHAPTER_BYTES) {
						finished++;
						fail("TOO_LARGE", "chapter expands beyond the size limit");
						return;
					}
					if (!oversized) {
						if (size > PER_ENTRY_CAP) {
							oversized = true;
							chunks.length = 0; // keep memory bounded
						} else {
							chunks.push(data);
						}
					}
					if (final) {
						const bytes = oversized ? (head as Uint8Array) : concatAll(chunks);
						entries.push({ name: file.name, bytes, oversized });
						chunks.length = 0;
						finished++;
						maybeDone();
					}
				};
				file.start();
			});
			// fflate ships only the stored-method decoder; deflate must be added.
			unz.register(UnzipInflate);
		} catch (err) {
			fail(
				"INVALID_INPUT",
				`not a readable ZIP archive: ${(err as Error).message}`,
			);
			return;
		}

		try {
			unz.push(uploadBytes, true);
		} catch (err) {
			fail(
				"INVALID_INPUT",
				`not a readable ZIP archive: ${(err as Error).message}`,
			);
			return;
		}
		pushedDone = true;
		// Zero-entry archives settle here; the rest settle via final ondata.
		queueMicrotask(maybeDone);
	});
}

/** Scan the tail for the End Of Central Directory signature PK\x05\x06. */
function hasEOCD(bytes: Uint8Array): boolean {
	const from = Math.max(0, bytes.length - 66_000);
	for (let i = bytes.length - 4; i >= from; i--) {
		if (
			bytes[i] === 0x50 &&
			bytes[i + 1] === 0x4b &&
			bytes[i + 2] === 0x05 &&
			bytes[i + 3] === 0x06
		) {
			return true;
		}
	}
	return false;
}

function concatAll(chunks: Uint8Array[]): Uint8Array {
	let len = 0;
	for (const c of chunks) len += c.length;
	const out = new Uint8Array(len);
	let off = 0;
	for (const c of chunks) {
		out.set(c, off);
		off += c.length;
	}
	return out;
}
