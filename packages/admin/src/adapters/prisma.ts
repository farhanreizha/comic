/**
 * Prisma-backed AdminDataPort. Transactions own atomicity: approve flips the
 * role with the status (invariant 10) and resolveReport pairs the status with
 * its effect (invariant 12). The module never sees a raw driver error.
 */

import type { Database } from "@comic/db";
import type { Role } from "@comic/reading";
import type {
	AdminDataPort,
	ApplicationRecord,
	ApplicationStatus,
	NewApplicationRow,
	PageWindow,
	ReportRecord,
	ReportStatus,
	UserRow,
} from "../types";

const isConflict = (error: unknown): boolean =>
	(error as { code?: string }).code === "P2002";

function conflict(): never {
	const error = new Error("unique constraint violation");
	(error as { code?: string }).code = "CONFLICT";
	throw error;
}

function notFound(message: string): never {
	const error = new Error(message);
	(error as { code?: string }).code = "NOT_FOUND";
	throw error;
}

const applicationSelect = {
	id: true,
	userId: true,
	user: { select: { id: true, name: true } },
	motivation: true,
	portfolioUrl: true,
	sampleKey: true,
	status: true,
	decidedAt: true,
	decidedBy: true,
	createdAt: true,
} as const;

type ApplicationRow = {
	id: string;
	userId: string;
	user: { id: string; name: string };
	motivation: string;
	portfolioUrl: string | null;
	sampleKey: string | null;
	status: string;
	decidedAt: Date | null;
	decidedBy: string | null;
	createdAt: Date;
};

const toApplication = (row: ApplicationRow): ApplicationRecord => ({
	id: row.id,
	applicant: { id: row.user.id, name: row.user.name },
	motivation: row.motivation,
	portfolioUrl: row.portfolioUrl,
	sampleKey: row.sampleKey,
	status: row.status as ApplicationStatus,
	decidedAt: row.decidedAt,
	decidedBy: row.decidedBy,
	createdAt: row.createdAt,
});

const reportSelect = {
	id: true,
	targetType: true,
	targetId: true,
	reporterId: true,
	reporter: { select: { id: true, name: true } },
	reason: true,
	note: true,
	status: true,
	resolvedAt: true,
	resolvedBy: true,
	createdAt: true,
} as const;

type ReportRow = {
	id: string;
	targetType: string;
	targetId: string;
	reporterId: string;
	reporter: { id: string; name: string };
	reason: string;
	note: string | null;
	status: string;
	resolvedAt: Date | null;
	resolvedBy: string | null;
	createdAt: Date;
};

const toReport = (row: ReportRow): ReportRecord => ({
	id: row.id,
	targetType: row.targetType as ReportRecord["targetType"],
	targetId: row.targetId,
	reporter: { id: row.reporter.id, name: row.reporter.name },
	reason: row.reason as ReportRecord["reason"],
	note: row.note,
	status: row.status as ReportStatus,
	resolvedAt: row.resolvedAt,
	resolvedBy: row.resolvedBy,
	createdAt: row.createdAt,
});

function windowWhere(window: PageWindow): Record<string, unknown> {
	if (!window.after) return {};
	return {
		OR: [
			{ createdAt: { gt: window.after.createdAt } },
			{
				createdAt: { equals: window.after.createdAt },
				id: { gt: window.after.id },
			},
		],
	};
}

export function createPrismaAdminData(db: Database): AdminDataPort {
	const userRowSelect = {
		id: true,
		name: true,
		role: true,
		suspendedAt: true,
		suspendReason: true,
	} as const;

	async function findUser(id: string): Promise<UserRow | null> {
		const row = await db.user.findUnique({
			where: { id },
			select: userRowSelect,
		});
		return row ? ({ ...row, role: row.role as Role } as UserRow) : null;
	}

	return {
		findUserById: findUser,
		findUserForSuspend: findUser,
		async setUserSuspension(userId, suspended, reason) {
			const updated = await db.user.updateMany({
				where: { id: userId },
				data: suspended
					? { suspendedAt: new Date(), suspendReason: reason }
					: { suspendedAt: null, suspendReason: null },
			});
			if (updated.count === 0) notFound("user not found");
		},
		async findLatestApplication(userId) {
			const row = await db.creatorApplication.findFirst({
				where: { userId },
				orderBy: [{ createdAt: "desc" }, { id: "desc" }],
				select: applicationSelect,
			});
			return row ? toApplication(row) : null;
		},
		async insertApplication(row: NewApplicationRow) {
			try {
				const created = await db.creatorApplication.create({
					data: {
						id: row.id,
						userId: row.userId,
						motivation: row.motivation,
						portfolioUrl: row.portfolioUrl,
						sampleKey: row.sampleKey,
					},
					select: applicationSelect,
				});
				return toApplication(created);
			} catch (error) {
				if (isConflict(error)) conflict();
				throw error;
			}
		},
		async listApplications(status, window) {
			const rows = await db.creatorApplication.findMany({
				where: {
					...(status ? { status } : {}),
					...windowWhere(window),
				} as never,
				orderBy: [{ createdAt: "asc" }, { id: "asc" }],
				take: window.limit,
				select: applicationSelect,
			});
			return rows.map(toApplication);
		},
		async findApplication(id) {
			const row = await db.creatorApplication.findUnique({
				where: { id },
				select: applicationSelect,
			});
			return row ? toApplication(row) : null;
		},
		async decideApplication(id, decision, adminId) {
			return db.$transaction(async (tx) => {
				// Guard inside the transaction: the module pre-checked, this makes
				// it atomic against a concurrent admin deciding the same row.
				const flipped = await tx.creatorApplication.updateMany({
					where: { id, status: "pending" },
					data: {
						status: decision === "approve" ? "approved" : "rejected",
						decidedAt: new Date(),
						decidedBy: adminId,
					},
				});
				if (flipped.count === 0) conflict();
				if (decision === "approve") {
					const app = await tx.creatorApplication.findUniqueOrThrow({
						where: { id },
						select: { userId: true },
					});
					await tx.user.update({
						where: { id: app.userId },
						data: { role: "creator" },
					});
				}
				const row = await tx.creatorApplication.findUniqueOrThrow({
					where: { id },
					select: applicationSelect,
				});
				return toApplication(row);
			});
		},
		async listReports(status, window) {
			const rows = await db.report.findMany({
				where: {
					...(status ? { status } : {}),
					...windowWhere(window),
				} as never,
				orderBy: [{ createdAt: "asc" }, { id: "asc" }],
				take: window.limit,
				select: reportSelect,
			});
			return rows.map(toReport);
		},
		async findReport(id) {
			const row = await db.report.findUnique({
				where: { id },
				select: reportSelect,
			});
			return row ? toReport(row) : null;
		},
		async resolveReport(id, action, adminId) {
			return db.$transaction(async (tx) => {
				const row = await tx.report.findUnique({
					where: { id },
					select: reportSelect,
				});
				if (!row) notFound("report not found");
				const flipped = await tx.report.updateMany({
					where: { id, status: "open" },
					data: {
						status: action === "dismiss" ? "dismissed" : "resolved",
						resolvedAt: new Date(),
						resolvedBy: adminId,
					},
				});
				if (flipped.count === 0) conflict();
				if (action === "hide_comment") {
					const hidden = await tx.comment.updateMany({
						where: { id: row.targetId },
						data: { hiddenAt: new Date() },
					});
					if (hidden.count === 0) notFound("comment not found");
				}
				if (action === "take_down_comic") {
					// Invariant 11 through the same door admin's setTakedown uses.
					const down = await tx.comic.updateMany({
						where: { id: row.targetId },
						data: {
							takenDownAt: new Date(),
							takedownReason: `report ${row.id}`,
							visibility: "private",
							status: "draft",
						},
					});
					if (down.count === 0) notFound("comic not found");
				}
				const updated = await tx.report.findUniqueOrThrow({
					where: { id },
					select: reportSelect,
				});
				return toReport(updated);
			});
		},
		async findComicForTakedown(comicId) {
			const found = await db.comic.findUnique({
				where: { id: comicId },
				select: { id: true },
			});
			return found !== null;
		},
		async setComicTakedown(comicId, takenDown, reason) {
			const updated = takenDown
				? await db.comic.updateMany({
						where: { id: comicId },
						data: {
							takenDownAt: new Date(),
							takedownReason: reason,
							visibility: "private",
							status: "draft",
						},
					})
				: await db.comic.updateMany({
						where: { id: comicId },
						data: {
							takenDownAt: null,
							takedownReason: null,
							// private stays; the owner republishes deliberately
							visibility: "private",
						},
					});
			if (updated.count === 0) notFound("comic not found");
		},
	};
}
