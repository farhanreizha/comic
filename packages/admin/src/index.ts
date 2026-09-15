/**
 * `admin` — creator applications, report resolution, takedown. Framework-free.
 * Role guarding lives at the entry points (invariant: every admin surface is
 * `viewer.role === "admin"`; applyForCreator is the applicant-side exception —
 * invariant 9 turns the role check into INVALID_INPUT for creator/admin.
 */

import { randomUUID } from "node:crypto";
import type {
	Admin,
	AdminDataPort,
	ApplicationStatus,
	PageWindow,
	ReportStatus,
	SampleFilesPort,
	Viewer,
} from "./types";
import { adminError, MAX_SAMPLE_BYTES } from "./types";

const DEFAULT_LIMIT = 20;

function currentUserId(viewer: Viewer): string {
	if (viewer.kind === "anonymous") {
		throw adminError("UNAUTHENTICATED", "login required");
	}
	return viewer.id;
}

/** The guard every admin surface shares. */
function adminId(viewer: Viewer): string {
	const id = currentUserId(viewer);
	if (viewer.kind === "user" && viewer.role !== "admin") {
		throw adminError("FORBIDDEN", "admin role required");
	}
	return id;
}

function decodeWindow(cursor: string | undefined, limit: number): PageWindow {
	let after: PageWindow["after"] = null;
	if (cursor !== undefined) {
		const [time, id] = cursor.split("\u0000");
		const ms = Number(time);
		if (time === undefined || id === undefined || !Number.isFinite(ms)) {
			throw adminError("INVALID_INPUT", "invalid cursor");
		}
		after = { createdAt: new Date(ms), id };
	}
	return { after, limit };
}

const encodeCursor = (r: { createdAt: Date; id: string }): string =>
	`${r.createdAt.getTime()}\u0000${r.id}`;

const APPLICATION_STATUSES: readonly ApplicationStatus[] = [
	"pending",
	"approved",
	"rejected",
];
const REPORT_STATUSES: readonly ReportStatus[] = [
	"open",
	"resolved",
	"dismissed",
];

function assertWindowInput(
	status: string | undefined,
	known: readonly string[],
): void {
	if (status !== undefined && !known.includes(status)) {
		throw adminError("INVALID_INPUT", `unknown status filter: ${status}`);
	}
}

export function createAdmin(deps: {
	data: AdminDataPort;
	files: SampleFilesPort;
}): Admin {
	const { data, files } = deps;

	return {
		async applyForCreator(viewer, input) {
			const userId = currentUserId(viewer);
			// Invariant 9: already creator/admin → INVALID_INPUT (not FORBIDDEN —
			// the application itself is the invalid thing, not the caller).
			if (viewer.kind === "user" && viewer.role !== "reader") {
				throw adminError("INVALID_INPUT", "already a creator or admin");
			}
			const motivation = input.motivation?.trim() ?? "";
			if (!motivation) {
				throw adminError("INVALID_INPUT", "motivation is required");
			}
			const portfolioUrl = input.portfolioUrl?.trim() || null;
			if (portfolioUrl && !/^https?:\/\/\S+$/.test(portfolioUrl)) {
				throw adminError(
					"INVALID_INPUT",
					"portfolioUrl must be an http(s) URL",
				);
			}
			const pending = await data.findLatestApplication(userId);
			if (pending?.status === "pending") {
				throw adminError("CONFLICT", "an application is already pending");
			}

			// Invariant 13: bytes move through the storage port only; the
			// filename never becomes a path — the key is minted here.
			let sampleKey: string | null = null;
			if (input.sample) {
				if (
					input.sample.bytes.length === 0 ||
					input.sample.bytes.length > MAX_SAMPLE_BYTES
				) {
					throw adminError(
						"INVALID_INPUT",
						`sample must be between 1 and ${MAX_SAMPLE_BYTES} bytes`,
					);
				}
				sampleKey = `applications/${randomUUID()}/sample`;
				await files.put(sampleKey, {
					bytes: input.sample.bytes,
					contentType: input.sample.contentType,
				});
			}

			// ponytail: a failed insert leaves the sample orphaned in storage —
			// unreachable, harmless; GC when object storage lands. The row is
			// not retried under the same key.
			return await data.insertApplication({
				id: randomUUID(),
				userId,
				motivation,
				portfolioUrl,
				sampleKey,
			});
		},

		async myApplication(viewer) {
			const userId = currentUserId(viewer);
			return await data.findLatestApplication(userId);
		},

		async listApplications(viewer, input) {
			adminId(viewer);
			assertWindowInput(input.status, APPLICATION_STATUSES);
			const window = decodeWindow(input.cursor, DEFAULT_LIMIT + 1);
			const rows = await data.listApplications(input.status ?? null, window);
			const items = rows.slice(0, DEFAULT_LIMIT);
			const last = items.at(-1);
			return {
				items,
				nextCursor:
					rows.length > DEFAULT_LIMIT && last ? encodeCursor(last) : null,
			};
		},

		async decideApplication(viewer, input) {
			const id = adminId(viewer);
			if (input.decision !== "approve" && input.decision !== "reject") {
				throw adminError("INVALID_INPUT", "decision must be approve or reject");
			}
			const found = await data.findApplication(input.id);
			if (!found) throw adminError("NOT_FOUND", "application not found");
			if (found.status !== "pending") {
				throw adminError("CONFLICT", "application already decided");
			}
			try {
				return await data.decideApplication(input.id, input.decision, id);
			} catch (error) {
				const code = (error as { code?: string }).code;
				if (code === "CONFLICT") {
					throw adminError("CONFLICT", "application already decided");
				}
				throw error;
			}
		},

		async listReports(viewer, input) {
			adminId(viewer);
			assertWindowInput(input.status, REPORT_STATUSES);
			const window = decodeWindow(input.cursor, DEFAULT_LIMIT + 1);
			const rows = await data.listReports(input.status ?? null, window);
			const items = rows.slice(0, DEFAULT_LIMIT);
			const last = items.at(-1);
			return {
				items,
				nextCursor:
					rows.length > DEFAULT_LIMIT && last ? encodeCursor(last) : null,
			};
		},

		async resolveReport(viewer, input) {
			const id = adminId(viewer);
			const actions = ["hide_comment", "take_down_comic", "dismiss"] as const;
			if (!actions.includes(input.action)) {
				throw adminError("INVALID_INPUT", "unknown resolve action");
			}
			const found = await data.findReport(input.id);
			if (!found) throw adminError("NOT_FOUND", "report not found");
			if (found.status !== "open") {
				// Invariant 12: idempotence is an error, not a silent no-op.
				throw adminError("CONFLICT", "report already resolved");
			}
			try {
				return await data.resolveReport(input.id, input.action, id);
			} catch (error) {
				const code = (error as { code?: string }).code;
				if (code === "CONFLICT") {
					throw adminError("CONFLICT", "report already resolved");
				}
				if (code === "NOT_FOUND") {
					throw adminError("NOT_FOUND", (error as Error).message);
				}
				throw error;
			}
		},

		async setTakedown(viewer, input) {
			adminId(viewer);
			if (typeof input.takenDown !== "boolean") {
				throw adminError("INVALID_INPUT", "takenDown must be a boolean");
			}
			const reason = input.reason?.trim() || null;
			const exists = await data.findComicForTakedown(input.comicId);
			if (!exists) throw adminError("NOT_FOUND", "comic not found");
			await data.setComicTakedown(input.comicId, input.takenDown, reason);
		},

		async suspendUser(viewer, input) {
			const admin = adminId(viewer);
			const user = await data.findUserForSuspend(input.userId);
			if (!user) throw adminError("NOT_FOUND", "user not found");
			// Lockout guard: an admin suspending themselves could strand the
			// whole admin surface. Suspending other admins stays allowed.
			if (user.id === admin) {
				throw adminError("INVALID_INPUT", "cannot suspend yourself");
			}
			if (user.suspendedAt) {
				throw adminError("CONFLICT", "user already suspended");
			}
			const reason = input.reason?.trim() || null;
			await data.setUserSuspension(input.userId, true, reason);
		},

		async unsuspendUser(viewer, input) {
			adminId(viewer);
			const user = await data.findUserForSuspend(input.userId);
			if (!user) throw adminError("NOT_FOUND", "user not found");
			if (!user.suspendedAt) {
				throw adminError("CONFLICT", "user is not suspended");
			}
			await data.setUserSuspension(input.userId, false, null);
		},
	};
}
