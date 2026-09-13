# Social and admin — interface design (H1)

Status: decided 2026-09-14. Companion to `reading-path.md` (read), `write-path.md` (write), `app-ui.md` (surfaces).
Scope: comments, ratings, follows, reports, creator applications, takedown, plus the two changes the earlier designs left open — `Page` dimensions and visibility under takedown.

## Decisions taken here (veto-able)

Where the earlier sessions did not specify behaviour, this document chooses. Each is reversible without data loss; if any is wrong, say so before the UI handoff lands.

1. **Takedown is not deletion.** `Comic.takenDownAt` + `takedownReason` are set, and the comic is forced to `private` + `draft`. Rows and files stay, so a mistaken takedown is one field away from reversible.
2. **A taken-down comic is invisible to everyone but admin** — including its owner. That is the point of a takedown; an owner who can still read it has not been taken down. This is the one place where the access rule changes and `canView` grows a rule.
3. **Comments are hidden, not deleted, by moderation.** `Comment.hiddenAt` set by admin; author deletion is a real delete of their own comment. No editing in v1.
4. **Ratings are 1–5 integers, one per `(user, comic)`, updatable.** Summary is average + count, computed on read.
5. **Follow is creator-level, no notifications in v1.** Self-follow is rejected.
6. **Reports target a comic or a comment**, carry a reason from a fixed enum, and one reporter may have at most one open report per target.
7. **Creator application carries motivation (required), portfolio URL (optional) and a sample upload (optional)**, is one-per-user and one-open-at-a-time, and approval is what grants the `creator` role.
8. **Page dimensions are captured at ingest** (`width`, `height`) because the decided reader is a continuous vertical scroll. Verified: `Bun.Image` in Bun 1.4.0 returns exact dimensions for PNG and JPEG with no new dependency.

## Schema additions

```prisma
model Page {
  // ...existing fields
  width  Int   // pixels, read at ingest
  height Int
}

model Comment {
  id        String    @id @default(cuid())
  comicId   String
  comic     Comic     @relation(fields: [comicId], references: [id], onDelete: Cascade)
  authorId  String
  author    User      @relation(fields: [authorId], references: [id], onDelete: Cascade)
  body      String
  hiddenAt  DateTime?
  createdAt DateTime  @default(now())
  @@index([comicId, createdAt])
  @@map("comment")
}

model Rating {
  id        String   @id @default(cuid())
  comicId   String
  comic     Comic    @relation(fields: [comicId], references: [id], onDelete: Cascade)
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  value     Int      // 1..5, enforced in the module
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@unique([userId, comicId])
  @@index([comicId])
  @@map("rating")
}

model Follow {
  id        String   @id @default(cuid())
  followerId String
  follower  User     @relation("following", fields: [followerId], references: [id], onDelete: Cascade)
  creatorId String
  creator   User     @relation("followers", fields: [creatorId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())
  @@unique([followerId, creatorId])
  @@index([creatorId])
  @@map("follow")
}

enum ReportTarget { comic comment }
enum ReportReason { sexual_content copyright harassment spam other }
enum ReportStatus { open resolved dismissed }

model Report {
  id         String       @id @default(cuid())
  targetType ReportTarget
  targetId   String
  reporterId String
  reporter   User         @relation(fields: [reporterId], references: [id], onDelete: Cascade)
  reason     ReportReason
  note       String?
  status     ReportStatus @default(open)
  resolvedAt DateTime?
  resolvedBy String?
  createdAt  DateTime     @default(now())
  @@unique([reporterId, targetType, targetId, status])   // one open report per reporter per target
  @@index([status, createdAt])
  @@map("report")
}

enum ApplicationStatus { pending approved rejected }

model CreatorApplication {
  id           String            @id @default(cuid())
  userId       String
  user         User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  motivation   String
  portfolioUrl String?
  sampleKey    String?           // storage key, written through the storage module
  status       ApplicationStatus @default(pending)
  decidedAt    DateTime?
  decidedBy    String?
  createdAt    DateTime          @default(now())
  @@index([status, createdAt])
  @@map("creator_application")
}
```

Also on `Comic`: `takenDownAt DateTime?`, `takedownReason String?`.

## Interface — two modules, both framework-free like `reading` and `publishing`

```ts
// packages/social
export type Social = {
  comment(viewer: Viewer, input: { comicId: string; body: string }): Promise<CommentView>;
  listComments(viewer: Viewer, input: { comicId: string; cursor?: string; limit?: number }): Promise<{ items: CommentView[]; nextCursor: string | null }>;
  deleteComment(viewer: Viewer, commentId: string): Promise<void>;
  rate(viewer: Viewer, input: { comicId: string; value: number }): Promise<RatingSummary>;
  ratingSummary(viewer: Viewer, comicId: string): Promise<RatingSummary>;
  follow(viewer: Viewer, input: { creatorId: string }): Promise<void>;
  unfollow(viewer: Viewer, input: { creatorId: string }): Promise<void>;
  report(viewer: Viewer, input: { targetType: "comic" | "comment"; targetId: string; reason: ReportReason; note?: string }): Promise<void>;
};

// packages/admin — every entry point requires viewer.role === "admin"
export type Admin = {
  applyForCreator(viewer: Viewer, input: { motivation: string; portfolioUrl?: string; sample?: Upload }): Promise<ApplicationView>;
  listApplications(viewer: Viewer, input: { status?: ApplicationStatus; cursor?: string }): Promise<{ items: ApplicationView[]; nextCursor: string | null }>;
  decideApplication(viewer: Viewer, input: { id: string; decision: "approve" | "reject" }): Promise<ApplicationView>;
  listReports(viewer: Viewer, input: { status?: ReportStatus; cursor?: string }): Promise<{ items: ReportView[]; nextCursor: string | null }>;
  resolveReport(viewer: Viewer, input: { id: string; action: "hide_comment" | "take_down_comic" | "dismiss" }): Promise<ReportView>;
  setTakedown(viewer: Viewer, input: { comicId: string; takenDown: boolean; reason?: string }): Promise<void>;
};
```

Ports, one per module, Prisma adapter for production plus an in-memory adapter for tests. `social` reads the comic through a small `ComicAccessPort` rather than importing the reading module's internals; `canView` itself is imported from `@comic/reading` so there is exactly one access decision in the codebase.

## Invariants

1. Every entry point requires an authenticated viewer except none — comments, ratings, follows and reports are all signed-in actions.
2. `comment` and `rate` require `canView(viewer, comic)` from `@comic/reading`. Commenting on a comic you cannot read is `NOT_FOUND`, not `FORBIDDEN` — the same hiding rule as the read path.
3. A taken-down comic fails `canView` for everyone except admin. Reads, comments, ratings and follows all inherit that through the single decision function; nothing duplicates the rule.
4. `deleteComment` allows the author or an admin; anyone else gets `FORBIDDEN`.
5. Hidden comments are absent from `listComments` for everyone except admin, and excluded from comment counts.
6. `rate` clamps nothing: a value outside 1–5 is `INVALID_INPUT`. Re-rating upserts the existing row.
7. `follow` on a non-creator is `INVALID_INPUT`; self-follow is `INVALID_INPUT`.
8. `report` on a target that does not exist, or that the reporter cannot see, is `NOT_FOUND`. A second open report by the same reporter on the same target is `CONFLICT`.
9. `applyForCreator` is `CONFLICT` while an application is pending, and `INVALID_INPUT` for a viewer who is already a creator or admin.
10. `decideApplication` approve sets the user's role to `creator` in the same transaction as the status change; reject stores no role change.
11. `setTakedown` sets `takenDownAt`/`takedownReason` and forces `visibility: private`, `status: draft`. Untakedown clears the fields and leaves the comic private — the owner republishes deliberately.
12. `resolveReport` is idempotent per report: an already-resolved report is `CONFLICT`, and `hide_comment` / `take_down_comic` perform their action in the same transaction as the status change.
13. Sample uploads in applications go through `packages/storage` like every other file; the module never touches a filesystem path.
14. Error codes reuse `PublishingError`'s vocabulary — `UNAUTHENTICATED | FORBIDDEN | NOT_FOUND | INVALID_INPUT | CONFLICT` — so the UI has one mapping table, not three.

## Ingest change

`ingestChapter` reads dimensions with `Bun.Image` for every image it stores and passes `width`/`height` into `NewPageRow`. An image `Bun.Image` cannot decode is `INVALID_INPUT` naming the file: it would break the reader's layout reservation, so it must not reach a `Page` row.

## Tests (module interface, in-memory adapters)

1. Comment on a comic you can read works; on a private comic you do not own → `NOT_FOUND`.
2. Anonymous comment/rate/follow/report → `UNAUTHENTICATED`.
3. Hidden comment disappears from public listing and counts, remains visible to admin.
4. Author deletes own comment; a third party gets `FORBIDDEN`; admin can delete any.
5. Rating upsert: second rating by the same user replaces the first and the summary moves; value 0 and 6 → `INVALID_INPUT`.
6. Follow a creator, unfollow, follow again; self-follow and follow-a-reader → `INVALID_INPUT`.
7. Duplicate open report → `CONFLICT`; report on an invisible comic → `NOT_FOUND`.
8. Application flow: pending blocks a second application; approve grants `creator`; reject leaves the role alone.
9. Takedown: comic leaves `browse` for everyone, `read` fails for owner too, admin still sees it; untakedown restores owner visibility only.
10. `resolveReport(hide_comment)` hides the comment in the same commit as the status change; a second resolve is `CONFLICT`.
11. Ingest stores real dimensions for a PNG and a JPEG fixture, and rejects a file `Bun.Image` cannot decode.

Test 9 is the one that proves the access rule has exactly one home.

## Rejected

- **Comment editing** — no caller asked; hiding plus delete covers moderation.
- **Threaded replies, likes, notifications** — not in the decided scope.
- **A per-comic comment counter column** — computed on read until a query actually hurts.
- **A separate access function for admin surfaces** — `canView` plus a role check at the entry point is the whole rule.
