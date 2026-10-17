# App Router

## When to use which

In order of preference — reach for the next one only when the previous doesn't fit:

1. **Server components** for display. Pages and layouts fetch their own data during render (through the
   `_lib` seams over `src/core`); never add an API route just to feed a page its own initial data.
2. **Server actions** for the page's main action — the mutation the user is there to perform (here, the
   Refresh scan). Actions are queued one at a time per client, which is fine for the main action and wrong
   for anything else.
3. **API routes** (route handlers) for what runs alongside the main flow — typeahead, polling, client-side
   reads after the initial render. None exist yet; don't add one while a server component can do the job.

## Structure

- The app's server actions live in `src/app/actions.ts`; a page that grows its own set moves them to an
  `actions.ts` next to its `page.tsx`.
- View components live in `src/app/_components/` (the underscore keeps the folder out of routing), grouped
  in a subfolder when a view has several (e.g. `_components/transcript/`). `src/components/ui/` is
  shadcn-vendored only.
- Server actions and route handlers are written with next-pipe (`actionPipe` / `routePipe`); reach for `pagePipe` when a page needs middlewares (gates, validated search
  params), not before.
- Components are server components by default; add `"use client"` only at the leaves that need
  interactivity, not on whole pages.
- Client components never import `src/core` (ADR-0002) — they receive data from server components or call a
  server action.

## Loading states

`cacheComponents` and `partialPrefetching` are on, so a default `<Link>` prefetches only the route's static shell; every DB read (behind `connection()` in `src/app/_lib/conversations.ts`) streams in after navigation, behind its Suspense fallback.

- Render the page header and every other control in the static shell, outside any `<Suspense>`: a control inside a boundary disappears until the data lands. A control whose href is built from `searchParams` (sort headers, pager, a filter toggle) belongs to the data region it controls, and that region's skeleton draws it — or, when it reads only `searchParams` and no data (the range picker), to its own small boundary, so it lands before the data.
- Give each data region its own `<Suspense>` right around the component that reads the data, with a `Skeleton` (`@/components/ui/skeleton`) fallback sized like the finished content, wrapped in a `LoadingRegion` (`src/app/_components/loading-region.tsx`) so the spec can find it; nest boundaries for a staged reveal. Never `fallback={null}` or a text-only fallback.
- Default to a focused `<Suspense>`; add a `loading.tsx` only when nothing below the layout can render without data — it wraps the whole page segment, not the segment's own layout.
- Links that change search params within a page (sort, range, pager, expand, sidebar folder) are `PendingLink`s (`src/app/_components/pending-link.tsx`), which dim `#main` while in flight; links that change route rely on the prefetched shell and its skeletons and need no `PendingLink`.
- Every route has an `instant()` spec asserting what its shell shows (`docs/codebase/testing.md`, "End-to-end"). Copy its client-navigation test with a section-tab click as the trigger line; `e2e/search.spec.ts` submits the search form only because no link leads to `/search`.
- Where the vendored optimizer skills in `.agents/skills/` differ from this section, this section wins.
