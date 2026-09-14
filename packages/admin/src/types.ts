/**
 * The `admin` module's vocabulary — see docs/design/social-admin.md.
 * Framework-free. Same five error codes as `social` (invariant 14).
 */

import type { Role, Viewer } from "@comic/reading";

export type { Role, Viewer };

export type AdminErrorCode =
	| "UNAUTHENTICATED"
	| "FORBIDDEN"
	| "NOT_FOUND"
	| "INVALID_INPUT"
	| "CONFLICT";

export type AdminError = Error & { code: AdminErrorCode };

export function adminError(code: AdminErrorCode, message: string): AdminError {
	const error = new Error(message) as AdminError;
	error.code = code;
	return error;
}

/** Spec is silent on sample size; it matches the page-image cap. One constant. */
export const MAX_SAMPLE_BYTES = 5 * 1024 * 1024;

export type ApplicationStatus = "pending" | "approved" | "rejected";
export type ReportStatus = "open" | "resolved" | "dismissed";
export type ReportTargetType = "comic" | "comment";
export type ReportReason =
	| "sexual_content"
	| "copyright"
	| "harassment"
	| "spam"
	| "other";

/** One file the browser sent — same shape as publishing's Upload. */
export type SampleUpload = {
	filename: string;
	contentType: string;
	bytes: Uint8Array;
};

export type ApplicationView = {
	id: string;
	applicant: { id: string; name: string };
	motivation: string;
	portfolioUrl: string | null;
	/** Storage key (never a path) when a sample was attached (invariant 13). */
	sampleKey: string | null;
	status: ApplicationStatus;
	decidedAt: Date | null;
	decidedBy: string | null;
	createdAt: Date;
};

export type ReportView = {
	id: string;
	targetType: ReportTargetType;
	targetId: string;
	reporter: { id: string; name: string };
	reason: ReportReason;
	note: string | null;
	status: ReportStatus;
	resolvedAt: Date | null;
	resolvedBy: string | null;
	createdAt: Date;
};

/* ---------- port record shapes ---------- */

export type NewApplicationRow = {
	id: string;
	userId: string;
	motivation: string;
	portfolioUrl: string | null;
	sampleKey: string | null;
};

export type ApplicationRecord = ApplicationView;
export type ReportRecord = ReportView;

/** `${createdAt.getTime()}\u0000${id}`, ASC — same window contract as social. */
export type PageWindow = {
	after: { createdAt: Date; id: string } | null;
	limit: number;
};

export type AdminDataPort = {
	findUserById(
		id: string,
	): Promise<{ id: string; name: string; role: Role } | null>;
	/** The applicant's most recent application, whatever its status. */
	findLatestApplication(userId: string): Promise<ApplicationRecord | null>;
	insertApplication(row: NewApplicationRow): Promise<ApplicationRecord>;
	listApplications(
		status: ApplicationStatus | null,
		window: PageWindow,
	): Promise<ApplicationRecord[]>;
	findApplication(id: string): Promise<ApplicationRecord | null>;
	/**
	 * Invariant 10: approve flips the status AND the user's role to creator
	 * inside one transaction. Reject touches no role.
	 */
	decideApplication(
		id: string,
		decision: "approve" | "reject",
		adminId: string,
	): Promise<ApplicationRecord>;
	listReports(
		status: ReportStatus | null,
		window: PageWindow,
	): Promise<ReportRecord[]>;
	findReport(id: string): Promise<ReportRecord | null>;
	/**
	 * Invariant 12: status change + its effect (hide comment / take down
	 * comic) in ONE transaction. Throws a NOT_FOUND-coded error when the
	 * effect's target row is gone; a CONFLICT-coded error when the report is
	 * already decided (the module pre-checks, the adapter makes it atomic).
	 */
	resolveReport(
		id: string,
		action: "hide_comment" | "take_down_comic" | "dismiss",
		adminId: string,
	): Promise<ReportRecord>;
	/** Exists-check for setTakedown (decideApplication/list use their own finds). */
	findComicForTakedown(comicId: string): Promise<boolean>;
	/**
	 * Invariant 11: takenDown=true sets takenDownAt/takedownReason and forces
	 * visibility private + status draft. false clears the fields and leaves
	 * the comic private — the owner republishes deliberately.
	 */
	setComicTakedown(
		comicId: string,
		takenDown: boolean,
		reason: string | null,
	): Promise<void>;
};

/** Sample files move through the storage module only (invariant 13). */
export type SampleFilesPort = {
	put(
		key: string,
		file: { bytes: Uint8Array; contentType: string },
	): Promise<void>;
};

export type Admin = {
	applyForCreator(
		viewer: Viewer,
		input: {
			motivation: string;
			portfolioUrl?: string;
			sample?: SampleUpload;
		},
	): Promise<ApplicationView>;
	/** The applicant's own latest application — the status card on /creator/apply. */
	myApplication(viewer: Viewer): Promise<ApplicationView | null>;
	listApplications(
		viewer: Viewer,
		input: { status?: ApplicationStatus; cursor?: string },
	): Promise<{ items: ApplicationView[]; nextCursor: string | null }>;
	decideApplication(
		viewer: Viewer,
		input: { id: string; decision: "approve" | "reject" },
	): Promise<ApplicationView>;
	listReports(
		viewer: Viewer,
		input: { status?: ReportStatus; cursor?: string },
	): Promise<{ items: ReportView[]; nextCursor: string | null }>;
	resolveReport(
		viewer: Viewer,
		input: {
			id: string;
			action: "hide_comment" | "take_down_comic" | "dismiss";
		},
	): Promise<ReportView>;
	setTakedown(
		viewer: Viewer,
		input: { comicId: string; takenDown: boolean; reason?: string },
	): Promise<void>;
};
