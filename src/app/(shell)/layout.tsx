import { Suspense } from "react";

import { FolderDisclosure } from "@/app/_components/folder-disclosure";
import { FolderSidebar } from "@/app/_components/folder-sidebar";
import { loadConversations } from "@/app/_lib/conversations";
import { formatGrandTotalCost } from "@/app/_lib/format";
import { buildListView } from "@/app/_lib/list-view";

// The analysis surfaces' frame (PR #13): the folder sidebar beside the page's
// <main>, shared by the conversation list (`/`), Trends and Tools. The app bar
// above it belongs to the root layout. This layout does NOT re-render on
// navigation within the group, so changing `?folder=`/sort/range never flashes
// the sidebar.
//
// Two columns from `lg` up; below that the page gets the full width and the
// folder list folds into a one-line disclosure above the content, so a phone
// does not scroll past every Project before reaching any data.
//
// The folder list is scope-independent (derived from ALL conversations), so
// the layout can build it without reading `searchParams` (which layouts cannot
// do anyway). Both this and the page call `loadConversations()`, but React
// `cache()` dedupes it to one read per request.
export default function ShellLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row lg:items-start lg:gap-8 lg:py-8">
      {/* The folder list is fetched at request time and its entries read the
          live URL — both reasons to keep it inside a Suspense boundary so the
          shell can prerender (Next local docs: use-search-params
          "Prerendering"). The fallback holds the sidebar's width so the page
          does not jump sideways when it lands. */}
      <Suspense fallback={<SidebarFallback />}>
        <Sidebar />
      </Suspense>
      <main id="main" tabIndex={-1} className="min-w-0 flex-1">
        {children}
      </main>
    </div>
  );
}

/**
 * The sidebar's data: derive the scope-independent folder list from ALL
 * conversations, and render it twice — as the desktop sidebar and as the
 * phone/tablet disclosure (CSS shows one). Nothing at all before the first
 * scan: an empty folder list is no navigation.
 */
async function Sidebar() {
  const allRows = await loadConversations();
  // No sort intent -> the scope-independent slice only (folder list + totals);
  // the table slice is skipped. The "All folders" anchor totals are summed from
  // the already-derived per-folder entries (no extra core touch).
  const { folders, totals } = buildListView(allRows);
  if (totals.count === 0) return null;

  const nav = (
    <FolderSidebar
      folders={folders}
      totalCount={totals.count}
      totalCost={totals.costUsd}
      totalUnpriced={totals.unpriced}
    />
  );
  const cost = (value: number, unpriced: boolean) => `${unpriced ? "~" : ""}${formatGrandTotalCost(value)}`;
  return (
    <>
      <aside className="hidden w-64 shrink-0 lg:block">{nav}</aside>
      <FolderDisclosure
        className="lg:hidden"
        totalCost={cost(totals.costUsd, totals.unpriced)}
        folders={folders.map((entry) => ({
          folder: entry.folder,
          label: entry.label,
          cost: cost(entry.costUsd, entry.unpriced),
        }))}
      >
        {nav}
      </FolderDisclosure>
    </>
  );
}

/** Holds the sidebar's place (desktop) or the disclosure's line (below `lg`). */
function SidebarFallback() {
  return (
    <div className="h-12 shrink-0 rounded-xl border border-dashed lg:h-auto lg:w-64 lg:border-0">
      <p className="sr-only lg:not-sr-only lg:px-3 lg:py-2 lg:text-sm lg:text-muted-foreground">Loading folders…</p>
    </div>
  );
}
