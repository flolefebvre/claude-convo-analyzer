import { Suspense } from "react";

import { FolderSidebar } from "@/app/_components/folder-sidebar";
import { RefreshButton } from "@/app/_components/refresh-button";
import { SearchBox } from "@/app/_components/search-box";
import { SectionNav } from "@/app/_components/section-nav";
import { ThemeToggle } from "@/app/_components/theme-toggle";
import { loadConversations } from "@/app/_lib/conversations";
import { buildListView } from "@/app/_lib/list-view";

// The persistent app chrome (PR #13): header + two-column sidebar/main grid,
// shared by the analysis surfaces — the conversation list (`/`) and Trends
// (`/trends`). It lived in the root layout, then in a `(list)` route group;
// with a second surface joining it the group is `(shell)`, since what it holds
// is the shell, not the list. The full-bleed `/conversation/<id>` transcript
// view (its own route, outside this group) still renders without the sidebar.
// This layout does NOT re-render on navigation within the group, so changing
// `?folder=`/sort/range never flashes the sidebar.
//
// The sidebar (section nav + folder list) is scope-independent (derived from ALL
// conversations), so the layout can build it without reading `searchParams`
// (which layouts cannot do anyway). Both this and the page call
// `loadConversations()`, but React `cache()` dedupes it to one read per request.
// Surface-specific chrome — e.g. the list's overview band — belongs to its page,
// not here.
export default function ShellLayout({
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
        {/* Header controls: full-text search, the Light/Dark/Auto theme toggle
            and the Refresh control. All bring their own client boundary; the
            layout stays a server component. */}
        <div className="flex items-center gap-3">
          <SearchBox />
          <ThemeToggle />
          <div data-slot="refresh-action">
            <RefreshButton />
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        <aside className="flex w-full shrink-0 flex-col gap-5 md:w-64">
          {/* The sidebar reads the live URL (usePathname/useSearchParams) for
              its active highlights, and its folder list is fetched at request
              time — both reasons to keep it inside Suspense boundaries so the
              shell can prerender (Next local docs: use-pathname "Cache
              Components", use-search-params "Prerendering"). */}
          <Suspense fallback={null}>
            <SectionNav />
          </Suspense>
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
