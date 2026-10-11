<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project notes (IG Insight Lab)

- Read `README.md` and `docs/meta-api-research.md` before changing data handling or the Instagram adapter.
- Missing values are `null`, never `0`. Rates go through `safeRate`.
- Every query must be scoped through `getContext()` / `requireAccount()` / `requireOwned()` so demo and real data, and the two accounts, never mix.
- Do not add Instagram metrics that are not confirmed in Meta's official docs; record new ones in `src/lib/catalog.ts` with their API availability.
- Run `npm test`, `npx tsc --noEmit` and `npm run lint` before committing.
