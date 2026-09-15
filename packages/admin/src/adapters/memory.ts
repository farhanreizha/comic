/**
 * In-memory AdminDataPort for tests. Mirrors the Prisma adapter's contract:
 * decide/resolve flip status (and role / hiddenAt / takedown fields) in one
 * step, and a second decide/resolve throws CONFLICT.
 */

import type { Role } from "@comic/reading";
import type {
	AdminDataPort,
	ApplicationRecord,
	NewApplicationRow,
	PageWindow,
	ReportRecord,
} from "../types";

function conflict(what: string): never {
	const error = new Error(what);
	(error as { code?: string }).code = "CONFLICT";
	throw error;
}

function notFound(what: string): never {
	const error = new Error(what);
	(error as { code?: string }).code = "NOT_FOUND";
	throw error;
}

export type MemoryAdminSeed = {
	users?: {
		id: string;
		name: string;
		role: Role;
		suspendedAt?: Date | null;
		suspendReason?: string | null;
	}[];
	comics?: {
		id: string;
		visibility: string;
		status: string;
		takenDownAt: Date | null;
		takedownReason: string | null;
	}[];
	comments?: { id: string; hiddenAt: Date | null }[];
	reports?: ReportRecord[];
};

export function createMemoryAdminData(
	seed: MemoryAdminSeed = {},
): AdminDataPort & {
	applications: ApplicationRecord[];
	reports: ReportRecord[];
	comics: NonNullable<MemoryAdminSeed["comics"]>;
	users: {
		id: string;
		name: string;
		role: Role;
		suspendedAt: Date | null;
		suspendReason: string | null;
	}[];
	comments: { id: string; hiddenAt: Date | null }[];
} {
	const users = (seed.users ?? []).map((u) => ({
		...u,
		suspendedAt: u.suspendedAt ?? null,
		suspendReason: u.suspendReason ?? null,
	}));
	const comics = (seed.comics ?? []).map((c) => ({ ...c }));
	const comments = (seed.comments ?? []).map((c) => ({ ...c }));
	const applications: ApplicationRecord[] = [];
	const reports = (seed.reports ?? []).map((r) => ({ ...r }));

	const userName = (id: string) => users.find((u) => u.id === id)?.name ?? id;

	const windowFilter = <T extends { createdAt: Date; id: string }>(
		rows: T[],
		window: PageWindow,
	): T[] => {
		let out = [...rows].sort(
			(a, b) =>
				a.createdAt.getTime() - b.createdAt.getTime() ||
				a.id.localeCompare(b.id),
		);
		if (window.after) {
			const { createdAt, id } = window.after;
			out = out.filter(
				(r) =>
					r.createdAt.getTime() > createdAt.getTime() ||
					(r.createdAt.getTime() === createdAt.getTime() && r.id > id),
			);
		}
		return out.slice(0, window.limit);
	};

	return {
		applications,
		reports,
		comics,
		users,
		comments,

		async findUserById(id) {
			return users.find((u) => u.id === id) ?? null;
		},
		async findUserForSuspend(userId) {
			return users.find((u) => u.id === userId) ?? null;
		},
		async setUserSuspension(userId, suspended, reason) {
			const user = users.find((u) => u.id === userId);
			if (!user) notFound("user not found");
			user.suspendedAt = suspended ? new Date() : null;
			user.suspendReason = suspended ? reason : null;
		},
		async findLatestApplication(userId) {
			const mine = applications
				.filter((a) => a.applicant.id === userId)
				.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
			return mine[0] ?? null;
		},
		async insertApplication(
			row: NewApplicationRow,
		): Promise<ApplicationRecord> {
			const record: ApplicationRecord = {
				id: row.id,
				applicant: { id: row.userId, name: userName(row.userId) },
				motivation: row.motivation,
				portfolioUrl: row.portfolioUrl,
				sampleKey: row.sampleKey,
				status: "pending",
				decidedAt: null,
				decidedBy: null,
				createdAt: new Date(),
			};
			applications.push(record);
			return record;
		},
		async listApplications(status, window) {
			const rows = applications.filter(
				(a) => status === null || a.status === status,
			);
			return windowFilter(rows, window);
		},
		async findApplication(id) {
			return applications.find((a) => a.id === id) ?? null;
		},
		async decideApplication(id, decision, adminId) {
			const app = applications.find((a) => a.id === id);
			if (!app) notFound("application not found");
			if (app.status !== "pending") conflict("application already decided");
			app.status = decision === "approve" ? "approved" : "rejected";
			app.decidedAt = new Date();
			app.decidedBy = adminId;
			if (decision === "approve") {
				const user = users.find((u) => u.id === app.applicant.id);
				if (user) user.role = "creator";
			}
			return app;
		},
		async listReports(status, window) {
			const rows = reports.filter(
				(r) => status === null || r.status === status,
			);
			return windowFilter(rows, window);
		},
		async findReport(id) {
			return reports.find((r) => r.id === id) ?? null;
		},
		async resolveReport(id, action, adminId) {
			const report = reports.find((r) => r.id === id);
			if (!report) notFound("report not found");
			if (report.status !== "open") conflict("report already resolved");
			// The effect happens BEFORE the status flip so a throwing effect
			// leaves the report open — same atomicity the Prisma transaction gives.
			if (action === "hide_comment") {
				const comment = comments.find((c) => c.id === report.targetId);
				if (!comment) notFound("comment not found");
				comment.hiddenAt = new Date();
			}
			if (action === "take_down_comic") {
				const comic = comics.find((c) => c.id === report.targetId);
				if (!comic) notFound("comic not found");
				comic.takenDownAt = new Date();
				comic.takedownReason = `report ${report.id}`;
				comic.visibility = "private";
				comic.status = "draft";
			}
			report.status = action === "dismiss" ? "dismissed" : "resolved";
			report.resolvedAt = new Date();
			report.resolvedBy = adminId;
			return report;
		},
		async findComicForTakedown(comicId) {
			return comics.some((c) => c.id === comicId);
		},
		async setComicTakedown(comicId, takenDown, reason) {
			const comic = comics.find((c) => c.id === comicId);
			if (!comic) notFound("comic not found");
			if (takenDown) {
				comic.takenDownAt = new Date();
				comic.takedownReason = reason;
				comic.visibility = "private";
				comic.status = "draft";
			} else {
				comic.takenDownAt = null;
				comic.takedownReason = null;
				comic.visibility = "private"; // invariant 11: owner republishes deliberately
			}
		},
	};
}
