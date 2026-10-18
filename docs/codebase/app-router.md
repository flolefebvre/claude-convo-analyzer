# App Router

## When to use which

In order of preference — reach for the next one only when the previous doesn't fit:

1. **Server components** for display. Pages and layouts fetch their own data during render (through the
   `_lib` seams over `src/core`); never add an API route just to feed a page its own initial data.
2. **Server actions** for the page's main action — the mutation the user is there to perform (here, the
   Refresh scan). Actions are queued one at a time per client, so an action must return at once rather than
   wait for long work: `refreshConversations` starts or joins the Refresh and answers `started` or
   `already running`, and the run's progress and outcome reach every open page over SSE (below).
3. **API routes** (route handlers) for what runs alongside the main flow — typeahead, polling, client-side
   reads after the initial render. Add one only for a read no server component can do: one the reader asks
   for after the page has rendered. The one such route, `GET /api/tool-call/[id]`, serves a Tool call's body
   the first time the reader opens it: the page ships only the summary, because a server component
   cannot render a body nobody has opened yet.
4. **Server-Sent Events** for what the server pushes to every open page while it happens — the Refresh's
   progress and outcome on the `refresh` Channel. Channels and their event schemas live in the next-sse
   Registry, `src/app/_lib/sse.ts`; server code publishes through its Handles, and a component subscribes
   through `src/app/_lib/sse.client.ts`, starting from a Snapshot its server part minted with
   `sse.snapshot(read)` behind `connection()`, in its own `<Suspense>`.

## Structure

- The app's server actions live in `src/app/actions.ts`; a page that grows its own set moves them to an
  `actions.ts` next to its `page.tsx`.
- View components live in `src/app/_components/` (the underscore keeps the folder out of routing), grouped
  in a subfolder when a view has several (e.g. `_components/transcript/`). `src/components/ui/` is
  shadcn-vendored only.
- Server actions and route handlers are written with next-pipe (`actionPipe` / `routePipe`); reach for `pagePipe` when a page needs middlewares (gates, validated search
  params), not before. The one exception is the SSE route, `src/app/api/sse/route.ts`, which re-exports
  next-sse's bare handler (`sse.handlers`): a route pipe always answers JSON and cannot stream.
- Components are server components by default; add `"use client"` only at the leaves that need
  interactivity, not on whole pages.
- Client components never import `src/core` (ADR-0002). They receive data from server components, call a
  server action, or call a route through `callRoute` and the generated `@/generated/routes` barrel
  (`pnpm gen`, gitignored, rebuilt by `postinstall`).

## Loading states

`cacheComponents` and `partialPrefetching` are on, so a default `<Link>` prefetches only the route's static shell; every DB read (behind `connection()` in `src/app/_lib/conversations.ts`) streams in after navigation, behind its Suspense fallback.

- Render the page header and every other control in the static shell, outside any `<Suspense>`: a control inside a boundary disappears until the data lands. A control whose href is built from `searchParams` (sort headers, pager, a filter toggle) belongs to the data region it controls, and that region's skeleton draws it — or, when it reads only `searchParams` and no data (the range picker), to its own small boundary, so it lands before the data.
- Give each data region its own `<Suspense>` right around the component that reads the data, with a `Skeleton` (`@/components/ui/skeleton`) fallback sized like the finished content, wrapped in a `LoadingRegion` (`src/app/_components/loading-region.tsx`) so the spec can find it; nest boundaries for a staged reveal. Never `fallback={null}` or a text-only fallback. The one exception is a region absent in the normal state, like the parser-update banner (`src/app/_components/parser-update-banner.tsx`): it gets `fallback={null}`, because a skeleton would flash a phantom banner on every load.
- Default to a focused `<Suspense>`; add a `loading.tsx` only when nothing below the layout can render without data — it wraps the whole page segment, not the segment's own layout.
- Links that change search params within a page (sort, range, pager, expand, sidebar folder, a transcript's agent) are `PendingLink`s (`src/app/_components/pending-link.tsx`), which dim `#main` while in flight: such a navigation keeps the current page on screen until the new render lands, and its skeletons don't come back. Links that change route rely on the prefetched shell and its skeletons and need no `PendingLink`.
- Every route has an `instant()` spec asserting what its shell shows (`docs/codebase/testing.md`, "End-to-end"). Copy its client-navigation test with a section-tab click as the trigger line; `e2e/search.spec.ts` submits the search form only because no link leads to `/search`.
- Where the vendored optimizer skills in `.agents/skills/` differ from this section, this section wins.
