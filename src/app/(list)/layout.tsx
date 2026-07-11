import { Suspense } from "react";

import { FolderSidebar } from "@/app/_components/folder-sidebar";
import { OverviewBand } from "@/app/_components/overview-band";
import { RefreshButton } from "@/app/_components/refresh-button";
import { ThemeToggle } from "@/app/_components/theme-toggle";
import { loadConversations } from "@/app/_lib/conversations";
import { buildListView } from "@/app/_lib/list-view";

// The persistent list chrome (PR #13): header + overview band + two-column
// sidebar/main grid. It lived in the root layout, but now sits in the `(list)`
// route group so ONLY the conversation-list surface is wrapped in it — the
// full-bleed `/conversation/<id>` transcript view (its own route, outside this
// group) renders without the folder sidebar. This layout does NOT re-render on
// navigation within the list, so changing `?folder=`/sort no longer flashes the
// sidebar.
//
// The sidebar's folder list is scope-independent (derived from ALL
// conversations), so the layout can build it without reading `searchParams`
// (which layouts cannot do anyway). Both this and the page call
// `loadConversations()`, but React `cache()` dedupes it to one read per request.
export default function ListLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <main className="mx-auto w-full max-w-7xl px-6 py-10">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Claude Conversation Analyzer
          </h1>
          <p className="text-sm text-muted-foreground">
            Every conversation from your local Claude Code logs, with token and
            cost rollups.
          </p>
        </div>
        {/* Header controls: the Light/Dark/Auto theme toggle and the Refresh
            control. Both are client components; the layout stays a server
            component. */}
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <div data-slot="refresh-action">
            <RefreshButton />
          </div>
        </div>
      </header>

      {/* The analysis surface, full-width above the split. Global (scope-
          independent), like the sidebar, so it can live in the layout — which
          cannot read `searchParams` — and persists across navigation without
          flashing. Its own Suspense boundary defers the request-time read out of
          prerendering (PPR). */}
      <Suspense fallback={null}>
        <Overview />
      </Suspense>

      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        <aside className="w-full shrink-0 md:w-64">
          {/* The sidebar reads the live URL (useSearchParams) for its active
              highlight, and its folder list is fetched at request time — both
              reasons to keep it inside a Suspense boundary so the shell can
              prerender (Next local docs: use-search-params "Prerendering"). */}
          <Suspense
            fallback={
              <p className="text-sm text-muted-foreground">Loading folders…</p>
            }
          >
            <Sidebar />
          </Suspense>
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </main>
  );
}

/**
 * The sidebar's data: derive the scope-independent folder list from ALL
 * conversations. Split out so the request-time read sits inside the layout's
 * <Suspense> boundary (the read is deferred out of prerendering via
 * `loadConversations`/`connection()`).
 */
async function Sidebar() {
  const allRows = await loadConversations();
  // No sort intent -> the scope-independent slice only (folder list + totals);
  // the table slice is skipped. The "All folders" anchor totals are summed from
  // the already-derived per-folder entries (no extra core touch).
  const { folders, totals } = buildListView(allRows);
  return (
    <FolderSidebar
      folders={folders}
      totalCount={totals.count}
      totalCost={totals.costUsd}
      totalUnpriced={totals.unpriced}
    />
  );
}

/**
 * The overview band's data: the headline aggregate plus the cost-ranked top
 * Projects, both derived from ALL conversations (scope-independent). Split out
 * so the request-time read sits inside its own <Suspense> boundary. The
 * `loadConversations()` read is deduped with the sidebar/page via React
 * `cache()`, so the band adds no extra DB work.
 */
async function Overview() {
  const allRows = await loadConversations();
  // No sort intent -> scope-independent slice only; one `deriveFolders` pass
  // feeds both the overview aggregate and the cost-ranked top Projects.
  const { overview, topProjects } = buildListView(allRows);
  return <OverviewBand overview={overview} topProjects={topProjects} />;
}
