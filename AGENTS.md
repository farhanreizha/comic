# comic

Comic publishing platform: creators apply and upload comics, admins approve and moderate, anyone can read.
Svelte (web) + Hono (server) + Bun + oRPC + better-auth + Postgres/Prisma, Turborepo, Biome.

## Agent skills

### Issue tracker

Issues and specs live as GitHub issues in `farhanreizha/comic`, driven via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Decisions

The 21 product decisions behind this repo — scope, access model, moderation, deploy — live in
`/home/shota/hermes-vault/Inbox/2026-09-13-comic-project-decisions.md`. Read it before changing
behaviour around access, storage, or moderation; it carries the reasoning this file points at
instead of repeating.

## Rules that outrank convenience

- **Access**: `visibility` (`public` | `unlisted` | `private`) and `status` (`draft` | `published`) are separate fields. Every comic read path, page images included, passes through `canView(user, comic)`.
- **Assets**: comic files move only through the `storage` module, so a move from local disk to object storage stays a one-file change.
- **Ingest**: an upload becomes `Comic` → `Chapter` → `Page`; CBZ/ZIP archives are extracted into `Page` rows, and pages are served as images.
- **Roles**: `reader` | `creator` | `admin`. Signup grants `reader`; a user reaches `creator` only through an approved application.
- **Genres**: the 12-value enum in code. Filtering uses it; the genre list stays code, not a table.
- **Limits**: 200 MB per chapter, 5 MB per image, each a single named constant.
- **i18n**: user-facing strings go through Paraglide (`id` default, `en` fallback, locale from cookie, clean URLs).
- **Content policy**: the platform publishes non-sexual comics. The report button plus admin takedown and suspend is how a violation leaves.

## Environment gotchas

- Postgres runs on host port **5433** (`docker compose up -d postgres`); 5432 belongs to another service on this machine.
- Env is varlock: `apps/server/.env` is the source of truth, `packages/db/.env.schema` imports from it, and each package's `src/env.ts` is generated. Edit the `.env` file; the generated types follow.
- Dependency versions live in the `catalog` block of the root `package.json`. Bump them there rather than in individual packages.
- Re-running Better-T-Stack on this repo rewrites `turbo.json` with `"interactive": true` on the `db:*` tasks, which breaks every non-TTY run (agents, CI). Restore `false`.
- Biome is the formatter and linter (`bun run check`). The husky pre-commit hook runs `lint-staged` → `biome check --write` on staged files, so formatting lands automatically at commit time.

## Verification gate

A change is done when `bun run check-types` and `bun run build` both pass, plus `bun run db:generate`
and `bun run db:push` when the Prisma schema moved.
