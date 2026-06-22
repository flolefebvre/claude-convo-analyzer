# UI interaction state lives in URL search params, not client state

## Status

accepted (decision amended 2026-06 — see "Amendment" below)

## Context

The conversation list is growing interactive controls: column sorting (already
shipped), and now a **folder filter** (issue: per-folder scoping) and a **dark
mode** toggle. Each could be built as client React state, but that would pull
the page off its current shape — a React Server Component that reads
`searchParams`, queries the core, and streams the table in via `<Suspense>`
with `cacheComponents`/PPR on (ADR-0002). Client state would also mean shipping
all rows to the browser and losing shareable/bookmarkable views.

## Decision

**View state is URL state.** Sorting and folder filtering are both encoded as
search params (`?sortBy=`, `?dir=`, `?folder=`). The server component reads them,
filters and sorts the rows it already fetched (both in the app zone — the core's
comparator handles only top-level scalars), and re-renders. The invariant is
**no front-end filtering/sorting of a client-held dataset**: the rows are
filtered and sorted on the server from the URL, never in browser JS. The
`?folder=` key is the Project's dash-encoded `folderName` (unique per on-disk
folder, slash-free, already stored); folders are displayed by their **friendly
name** (path basename) with the full path shown beneath.

**Client JS is the deliberate exception, used only where the platform forces it:**
row expand/collapse (local UI state + lazy detail fetch, already shipped) and the
**theme toggle** (dark mode needs a client `ThemeProvider`). Dark mode uses
`next-themes` with `attribute="class"`, `defaultTheme="system"`; the `.dark`
design tokens already exist in `globals.css`.

## Amendment (2026-06): client JS for navigation and view-persistence

The original decision said the sidebar and header links are "plain `<a>` tags —
no client JS." That wording was too strict and is corrected here. Its TRUE
intent was only that **data filtering and sorting stay server-side, driven by
the URL** — NOT a ban on client JS for navigation or for keeping view chrome
mounted across navigations.

Client JS IS therefore permitted for **navigation and view-persistence**, in
addition to the platform-forced exceptions above:

- **`next/link` `<Link>` for navigation.** The sidebar entries, the
  "All folders" link, the sortable column headers, the folder breadcrumb, and
  the empty-state clear-filter link all use `<Link>` instead of `<a>` so a click
  is a client-side transition rather than a full document reload. The hrefs are
  identical (`folderHref`/`sortHref`); only the element changes — no data
  filtering moves to the client.
- **A persistent sidebar rendered in the root layout.** The two-column shell
  (sidebar + main) lives in the layout, which does NOT re-render on navigation,
  so the sidebar no longer flashes/reloads when changing `?folder=`/sort. The
  folder list + counts are scope-independent (derived from ALL conversations),
  so the layout can build them without reading search params.
- **A small `"use client"` component for the active-folder highlight.** Because
  layouts cannot read `searchParams` (they would go stale — Next local docs,
  `layout.md` "Query params"), the active-entry highlight is decided client-side
  via the `useSearchParams` hook. It only chooses which entry is "active" and
  applies the active styling/`aria-current`; the labels and counts stay
  server-rendered, and it imports no core values.

The server-side filter/sort invariant from the Decision is unchanged.

## Consequences

- Filtered/sorted views are shareable and bookmarkable; reloads preserve them;
  the RSC/PPR streaming model is untouched.
- No client-side data-table library; filtering and sorting stay in the
  app-zone pure modules (`_lib/sort.ts`, and a new `_lib/folders.ts`), unit-test
  friendly and free of React/I/O.
- Instant (no round-trip) filtering is given up. Acceptable for a local,
  single-user tool where each navigation is a fast local DB read.
- `next-themes` is the one new client dependency; the `<html>` element needs
  `suppressHydrationWarning` because the provider mutates its class.
