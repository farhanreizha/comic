/**
 * PDF reading — INTERNAL SEAM, not a port (docs/design/write-path.md line
 * 109 named PDF as its trigger; `archive.ts` has the same status). Renders
 * every page of a PDF to PNG in document order. The renderer is injectable
 * so the module boundary stays framework-free and tests can stub rendering;
 * the default pairs pdfjs-dist (pure JS) with @napi-rs/canvas (native N-API
 * prebuilt — linux-x64 gnu AND musl both ship; verified on oven/bun:1).
 *
 * pdfjs 5.7 self-polyfills Path2D/DOMMatrix/ImageData from @napi-rs/canvas
 * when it resolves the package, so no globalThis patching happens here.
 *
 * Size guards run DURING rendering, before any page is returned: per-page
 * MAX_IMAGE_BYTES, summed MAX_CHAPTER_BYTES, MAX_PAGES_PER_CHAPTER from the
 * document's own page count. Parse/decrypt failures reject with
 * INVALID_INPUT (encrypted PDFs are rejected, never unlocked).
 */

import {
	MAX_CHAPTER_BYTES,
	MAX_IMAGE_BYTES,
	MAX_PAGES_PER_CHAPTER,
	publishingError,
} from "./types";

export type RenderedPdfPage = {
	/** PNG bytes — the render format is fixed so Page rows stay sniffable. */
	bytes: Uint8Array;
	contentType: "image/png";
};

export type PdfRenderer = (
	bytes: Uint8Array,
	filename: string,
) => Promise<RenderedPdfPage[]>;

/** Long edge of a rendered page in px — big enough for retina readers,
 * small enough that the page cap stays physical. */
const RENDER_LONG_EDGE = 1600;

/** pdfjs needs standard font binaries (Helvetica etc.); resolve once from
 * the installed package. pdfjs's Node data factory plain-fs.readFiles the
 * URL, so hand it a filesystem path, not a file:// URL (Bun's readFile
 * rejects file:// strings). Undefined = embedded fonts only. */
let fontsUrl: string | undefined | null = null;
function standardFontDataUrl(): string | undefined {
	if (fontsUrl === null) {
		fontsUrl = undefined;
		try {
			const here = import.meta.resolve("pdfjs-dist/legacy/build/pdf.mjs");
			const dir = new URL(here).pathname;
			fontsUrl = `${dir.slice(0, dir.lastIndexOf("legacy/"))}standard_fonts/`;
		} catch {
			// resolution failed once; it will not start working later
		}
	}
	return fontsUrl;
}

/** Map any failure onto the module's error codes. Size/limit verdicts pass
 * through; everything the document layer says about a bad file (magic
 * bytes, encryption, truncated xref) is INVALID_INPUT. */
function asPublishingError(err: unknown, filename: string): Error {
	const code = (err as { code?: string }).code;
	if (
		code === "INVALID_INPUT" ||
		code === "TOO_LARGE" ||
		code === "LIMIT_EXCEEDED"
	) {
		return err as Error;
	}
	const name = (err as { name?: string }).name ?? "";
	if (name === "PasswordException") {
		return publishingError(
			"INVALID_INPUT",
			"PDF is password-protected — remove encryption before uploading",
			filename,
		);
	}
	return publishingError(
		"INVALID_INPUT",
		`could not read PDF: ${(err as Error).message}`,
		filename,
	);
}

/** Default renderer: pdfjs-dist legacy build + @napi-rs/canvas. Dynamic
 * imports keep the native module out of every non-PDF ingest and out of
 * type-only consumers. */
type PdfDoc = {
	numPages: number;
	getPage(n: number): Promise<any>;
	destroy(): Promise<void>;
};

export const renderPdfPages: PdfRenderer = async (bytes, filename) => {
	let doc: PdfDoc | undefined;
	try {
		const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
		let loaded: PdfDoc;
		try {
			loaded = (await pdfjs.getDocument({
				data: new Uint8Array(bytes), // pdfjs may detach the input buffer
				useWorkerFetch: false,
				disableFontFace: true,
				standardFontDataUrl: standardFontDataUrl(),
			}).promise) as PdfDoc;
			doc = loaded;
		} catch (err) {
			// InvalidPDF/Password rejects surface on the loading task's promise.
			throw asPublishingError(err, filename);
		}
		if (loaded.numPages > MAX_PAGES_PER_CHAPTER) {
			throw publishingError(
				"LIMIT_EXCEEDED",
				`PDF has more than ${MAX_PAGES_PER_CHAPTER} pages`,
				filename,
			);
		}
		const { createCanvas, Path2D, DOMMatrix, ImageData } = await import(
			"@napi-rs/canvas"
		);
		// pdfjs nests its OWN @napi-rs/canvas copy (0.1.100 vs our 1.0.9);
		// its auto-polyfill would hand our 1.0.9 contexts a foreign Path2D
		// (skia rejects it: "Value is none of these types String, Path").
		// Setting the globals first makes pdfjs skip its own polyfill.
		Object.assign(globalThis, { Path2D, DOMMatrix, ImageData });
		const out: RenderedPdfPage[] = [];
		let total = 0;
		for (let i = 1; i <= doc.numPages; i++) {
			const page = await doc.getPage(i);
			const base = page.getViewport({ scale: 1 });
			// Deterministic: cap the long edge, never upscale past 1.0.
			const scale = Math.min(
				1,
				RENDER_LONG_EDGE / Math.max(base.width, base.height),
			);
			const viewport = page.getViewport({ scale });
			const canvas = createCanvas(
				Math.ceil(viewport.width),
				Math.ceil(viewport.height),
			);
			await page.render({
				canvas,
				canvasContext: canvas.getContext("2d"),
				viewport,
				background: "#ffffff",
			}).promise;
			const png = new Uint8Array(canvas.toBuffer("image/png"));
			if (png.length > MAX_IMAGE_BYTES) {
				throw publishingError(
					"TOO_LARGE",
					`rendered page ${i} exceeds the per-image size limit`,
					filename,
				);
			}
			total += png.length;
			if (total > MAX_CHAPTER_BYTES) {
				throw publishingError(
					"TOO_LARGE",
					"rendered chapter exceeds the size limit",
					filename,
				);
			}
			out.push({ bytes: png, contentType: "image/png" });
		}
		return out;
	} catch (err) {
		throw asPublishingError(err, filename);
	} finally {
		await doc?.destroy().catch(() => {});
	}
};
