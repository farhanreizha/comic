/**
 * Sniffing + ordering rules for uploaded bytes — invariants 2 and 3.
 * The browser-supplied filename/contentType are advisory; bytes decide.
 */

import type { Upload } from "./types";
import { MAX_IMAGE_BYTES, publishingError } from "./types";

export type SniffedType =
	| "image/jpeg"
	| "image/png"
	| "image/webp"
	| "image/gif"
	| "image/avif";

/** Magic-byte sniffing (invariant 2). Returns null when bytes are not a page image. */
export function sniffImageType(bytes: Uint8Array): SniffedType | null {
	const four = (o: number) =>
		bytes.length >= o + 4 &&
		bytes[o] === 0x52 &&
		bytes[o + 1] === 0x49 &&
		bytes[o + 2] === 0x46 &&
		bytes[o + 3] === 0x46; // "RIFF"
	if (
		bytes.length >= 3 &&
		bytes[0] === 0xff &&
		bytes[1] === 0xd8 &&
		bytes[2] === 0xff
	) {
		return "image/jpeg";
	}
	if (
		bytes.length >= 8 &&
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 && // .PNG
		bytes[2] === 0x4e &&
		bytes[3] === 0x47
	) {
		return "image/png";
	}
	if (
		four(0) &&
		bytes.length >= 12 &&
		String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!) === "WEBP"
	) {
		return "image/webp";
	}
	if (
		bytes.length >= 6 &&
		bytes[0] === 0x47 && // GIF8
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[3] === 0x38
	) {
		return "image/gif";
	}
	// ISO-BMFF: ....ftypavif
	if (
		bytes.length >= 12 &&
		bytes[4] === 0x66 && // ftyp
		bytes[5] === 0x74 &&
		bytes[6] === 0x79 &&
		bytes[7] === 0x70 &&
		String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!) === "avif"
	) {
		return "image/avif";
	}
	return null;
}

const EXT_BY_TYPE: Record<SniffedType, string> = {
	"image/jpeg": "jpg",
	"image/png": "png",
	"image/webp": "webp",
	"image/gif": "gif",
	"image/avif": "avif",
};

export const extForType = (t: SniffedType): string => EXT_BY_TYPE[t];

/**
 * Natural-order comparison: digit runs compare numerically, so page2 < page10
 * (invariant 3). Case-insensitive, stable via a fallback on the raw name.
 */
export function naturalCompare(a: string, b: string): number {
	const la = a.toLowerCase();
	const lb = b.toLowerCase();
	let i = 0;
	let j = 0;
	while (i < la.length && j < lb.length) {
		const ca = la[i]!;
		const cb = lb[j]!;
		const da = ca >= "0" && ca <= "9";
		const db = cb >= "0" && cb <= "9";
		if (da && db) {
			let ie = i;
			let je = j;
			while (ie < la.length && la[ie]! >= "0" && la[ie]! <= "9") ie++;
			while (je < lb.length && lb[je]! >= "0" && lb[je]! <= "9") je++;
			const na = la.slice(i, ie).replace(/^0+/, "");
			const nb = lb.slice(j, je).replace(/^0+/, "");
			if (na.length !== nb.length) return na.length - nb.length;
			if (na !== nb) return na < nb ? -1 : 1;
			i = ie;
			j = je;
		} else {
			if (ca !== cb) return ca < cb ? -1 : 1;
			i++;
			j++;
		}
	}
	return la.length - lb.length || (a < b ? -1 : a > b ? 1 : 0);
}

/** Bytes of a per-image-limit check across uploads; throws TOO_LARGE naming the file (invariant 8). */
export function assertEachWithinImageLimit(uploads: readonly Upload[]): void {
	for (const u of uploads) {
		if (u.bytes.length > MAX_IMAGE_BYTES) {
			throw publishingError(
				"TOO_LARGE",
				`image exceeds ${MAX_IMAGE_BYTES} bytes`,
				u.filename,
			);
		}
	}
}

export type Dimensions = { width: number; height: number };

/**
 * Pixel dimensions from header metadata (social-admin.md decision 8).
 * `new Bun.Image(bytes).metadata()` is the ONLY working read path on Bun
 * 1.4.0 — the synchronous `img.width`/`img.height` accessors are the
 * *output* dimensions and stay -1 until a terminal runs. Undecodable
 * images return null; the caller must reject them — an image the reader
 * cannot size would break its layout reservation.
 */
export async function imageDimensions(
	bytes: Uint8Array,
): Promise<Dimensions | null> {
	try {
		const meta = await new Bun.Image(bytes).metadata();
		if (
			typeof meta.width !== "number" ||
			typeof meta.height !== "number" ||
			meta.width <= 0 ||
			meta.height <= 0
		) {
			return null;
		}
		return { width: meta.width, height: meta.height };
	} catch {
		return null;
	}
}
