import { createAdmin } from "@comic/admin";
import { createPrismaAdminData } from "@comic/admin/adapters/prisma";
import { createStorageSamplePort } from "@comic/admin/adapters/storage-files";
import { MAX_SAMPLE_BYTES } from "@comic/admin/types";
import type { Database } from "@comic/db";
import type { StorageAdapter } from "@comic/storage";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { o } from "../index";

/** The one admin guard the transport must add: role at the entry point.
 * The module re-checks viewer.role === "admin" on every surface — defence
 * in depth, both fail FORBIDDEN. */
const requireAdmin = o.middleware(async ({ context, next }) => {
	if (context.viewer.kind !== "user" || context.viewer.role !== "admin") {
		throw new ORPCError("FORBIDDEN", { message: "admin role required" });
	}
	return next();
});
const adminProcedure = o.use(requireAdmin);

async function crossSeam<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (error) {
		const code = (error as { code?: string }).code;
		const message = (error as Error).message;
		switch (code) {
			case "NOT_FOUND":
				throw new ORPCError("NOT_FOUND", { cause: error });
			case "UNAUTHENTICATED":
				throw new ORPCError("UNAUTHORIZED", { cause: error });
			case "FORBIDDEN":
				throw new ORPCError("FORBIDDEN", { cause: error });
			case "INVALID_INPUT":
				throw new ORPCError("BAD_REQUEST", { message, cause: error });
			case "CONFLICT":
				throw new ORPCError("CONFLICT", { cause: error });
			default:
				throw error;
		}
	}
}

function adminIn(db: Database, storage: StorageAdapter) {
	return createAdmin({
		data: createPrismaAdminData(db),
		files: createStorageSamplePort(storage),
	});
}

const uploadOf = async (file: File) => ({
	filename: file.name,
	contentType: file.type,
	bytes: new Uint8Array(await file.arrayBuffer()),
});

const applicationInput = z.object({
	motivation: z.string().min(1).max(5000),
	portfolioUrl: z.string().url().max(2000).optional(),
	// Same FormData channel publishing's ingest uses; the module re-checks size.
	sample: z.file().max(MAX_SAMPLE_BYTES).optional(),
});

export const adminRouter = {
	/** Applicant-side: any authenticated reader may apply; the module
	 * rejects creator/admin applicants with INVALID_INPUT (invariant 9). */
	applyForCreator: o
		.input(applicationInput)
		.handler(async ({ input, context }) =>
			crossSeam(async () => {
				const { sample, ...rest } = input;
				return adminIn(context.db, context.storage).applyForCreator(
					context.viewer,
					{
						...rest,
						sample: sample ? await uploadOf(sample) : undefined,
					},
				);
			}),
		),

	/** The viewer's own latest application (status card on /creator/apply). */
	myApplication: o.handler(async ({ context }) =>
		crossSeam(async () => {
			const found = await adminIn(context.db, context.storage).myApplication(
				context.viewer,
			);
			if (!found) return null;
			// The storage key is an internal handle; the UI reaches bytes via
			// the admin-only sample download route, never the key itself.
			const { sampleKey: _omit, ...rest } = found;
			return rest;
		}),
	),

	listApplications: adminProcedure
		.input(
			z.object({
				status: z.enum(["pending", "approved", "rejected"]).optional(),
				cursor: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) =>
			crossSeam(() =>
				adminIn(context.db, context.storage).listApplications(
					context.viewer,
					input,
				),
			),
		),

	decideApplication: adminProcedure
		.input(
			z.object({
				id: z.string().min(1),
				decision: z.enum(["approve", "reject"]),
			}),
		)
		.handler(async ({ input, context }) =>
			crossSeam(() =>
				adminIn(context.db, context.storage).decideApplication(
					context.viewer,
					input,
				),
			),
		),

	listReports: adminProcedure
		.input(
			z.object({
				status: z.enum(["open", "resolved", "dismissed"]).optional(),
				cursor: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) =>
			crossSeam(() =>
				adminIn(context.db, context.storage).listReports(context.viewer, input),
			),
		),

	resolveReport: adminProcedure
		.input(
			z.object({
				id: z.string().min(1),
				action: z.enum(["hide_comment", "take_down_comic", "dismiss"]),
			}),
		)
		.handler(async ({ input, context }) =>
			crossSeam(() =>
				adminIn(context.db, context.storage).resolveReport(
					context.viewer,
					input,
				),
			),
		),

	setTakedown: adminProcedure
		.input(
			z.object({
				comicId: z.string().min(1),
				takenDown: z.boolean(),
				reason: z.string().max(2000).optional(),
			}),
		)
		.handler(async ({ input, context }) =>
			crossSeam(() =>
				adminIn(context.db, context.storage).setTakedown(context.viewer, input),
			),
		),

	suspendUser: adminProcedure
		.input(
			z.object({
				userId: z.string().min(1),
				reason: z.string().max(2000).optional(),
			}),
		)
		.handler(async ({ input, context }) =>
			crossSeam(() =>
				adminIn(context.db, context.storage).suspendUser(context.viewer, input),
			),
		),

	unsuspendUser: adminProcedure
		.input(z.object({ userId: z.string().min(1) }))
		.handler(async ({ input, context }) =>
			crossSeam(() =>
				adminIn(context.db, context.storage).unsuspendUser(
					context.viewer,
					input,
				),
			),
		),
};
