/**
 * Write-path UI helpers: one error-code mapping table (invariant 14 —
 * publishing, social and admin share the vocabulary) and the XHR uploader,
 * because fetch() cannot report upload progress.
 */

import { MAX_CHAPTER_BYTES } from "@comic/publishing/types";
import { m } from "$paraglide/messages.js";

/** Transport ceiling: above this Bun answers an EMPTY 413 no UI can explain
 *  (apps/server/src/publishing.ts MAX_UPLOAD_BYTES). Same formula, single
 *  constant imported from the module. */
export const MAX_SEND_BYTES = MAX_CHAPTER_BYTES + 8 * 1024 * 1024;

export type MappedError = { message: string; filename?: string };

/** Codes from two shapes: the oRPC client (ORPCError-style `code`) and the
 *  raw JSON of POST /publish/chapters (`code` verbatim). One table. */
export function mapWriteError(error: unknown): MappedError {
	const e = error as {
		code?: string;
		message?: string;
		data?: { filename?: string };
	};
	const filename = e?.data?.filename;
	switch (e?.code) {
		// oRPC transport names
		case "UNAUTHORIZED":
			return { message: m.err_signin(), filename };
		case "FORBIDDEN":
			return { message: m.err_forbidden(), filename };
		case "NOT_FOUND":
			return { message: m.err_not_found(), filename };
		case "BAD_REQUEST":
			return { message: e.message ? e.message : m.err_invalid(), filename };
		case "CONTENT_TOO_LARGE":
			return { message: m.err_too_large(), filename };
		case "CONFLICT":
			return { message: m.err_conflict(), filename };
		// raw-module codes (the Hono upload route answers these verbatim)
		case "UNAUTHENTICATED":
			return { message: m.err_signin(), filename };
		case "INVALID_INPUT":
			return { message: e.message ? e.message : m.err_invalid(), filename };
		case "TOO_LARGE":
			return { message: m.err_too_large(), filename };
		case "LIMIT_EXCEEDED":
			return { message: m.err_limit(), filename };
		default:
			return { message: m.error_generic() };
	}
}

/** Rendered error line: message + the filename the module set, verbatim. */
export function errorText(mapped: MappedError): string {
	return mapped.filename
		? `${mapped.message} (${mapped.filename})`
		: mapped.message;
}

export type UploadOutcome =
	| { ok: true; json: unknown }
	| { ok: false; status: number; error: unknown };

/**
 * Multipart POST with a real percentage. The server answers errors as JSON
 * bodies; anything without one (empty 413, network) maps to a code the UI
 * table understands.
 */
export function xhrUpload(
	url: string,
	form: FormData,
	onProgress: (fraction: number) => void,
): Promise<UploadOutcome> {
	return new Promise((resolve) => {
		const xhr = new XMLHttpRequest();
		xhr.open("POST", url);
		xhr.withCredentials = true;
		xhr.upload.onprogress = (ev) => {
			if (ev.lengthComputable) onProgress(ev.loaded / ev.total);
		};
		xhr.onload = () => {
			let body: unknown = null;
			try {
				body = JSON.parse(xhr.responseText);
			} catch {
				/* empty 413 or HTML error page */
			}
			if (xhr.status >= 200 && xhr.status < 300) {
				resolve({ ok: true, json: body });
				return;
			}
			const code = (body as { code?: string } | null)?.code;
			resolve({
				ok: false,
				status: xhr.status,
				error:
					body && code
						? body
						: { code: xhr.status === 413 ? "TOO_LARGE" : undefined },
			});
		};
		xhr.onerror = () => resolve({ ok: false, status: 0, error: {} });
		xhr.send(form);
	});
}

export const formatMB = (bytes: number): string =>
	`${Math.round(bytes / (1024 * 1024))} MB`;
