import { Suspense } from "react";

import { FolderDisclosure } from "@/app/_components/folder-disclosure";
import { FolderSidebar } from "@/app/_components/folder-sidebar";
import { FOLDER_ROW_COST_COLUMN, SidebarLeadingSlot } from "@/app/_components/folder-rows";
import { LoadingRegion } from "@/app/_components/loading-region";
import { homeDirectory, loadConversations, loadFavoriteFolderPaths } from "@/app/_lib/conversations";
import { deriveFavoriteFolders } from "@/app/_lib/favorites";
import { buildListView } from "@/app/_lib/list-view";
import { Skeleton } from "@/components/ui/skeleton";

// The analysis surfaces' frame (PR #13): the folder sidebar beside the page's
// <main>, shared by the conversation list (`/`), Trends and Tools. The app bar
// above it belongs to the root layout. This layout does NOT re-render on
// navigation within the group, so changing `?folder=`/sort/range never flashes
// the sidebar.
//
// Two columns from `lg` up; below that the page gets the full width and the
// folder tree folds into a one-line disclosure above the content, so a phone
// does not scroll past every Project before reaching any data.
//
// The folder tree is scope-independent (derived from ALL conversations), so
// the layout can build it without reading `searchParams` (which layouts cannot
// do anyway). Both this and the page call `loadConversations()`, but React
// `cache()` dedupes it to one read per request.
export default function ShellLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="mx-auto flex w-full max-w-frame flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row lg:items-start lg:gap-8 lg:py-8">
      {/* The folder tree is fetched at request time and its entries read the
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
 * The sidebar's data: derive the scope-independent folder tree from ALL
 * conversations, and render it twice — as the desktop sidebar and as the
 * phone/tablet disclosure (CSS shows one). Nothing at all before the first
 * scan: an empty folder tree is no navigation.
 */
async function Sidebar() {
  const [allRows, favoritePaths] = await Promise.all([loadConversations(), loadFavoriteFolderPaths()]);
  // No sort intent -> the scope-independent slice only (folder tree + totals);
  // the table slice is skipped. The "All folders" anchor totals and the
  // favorites' totals are summed from the already-derived per-folder entries
  // (no extra core touch).
  const { folders, folderTree, totals } = buildListView(allRows, homeDirectory());
  if (totals.count === 0) return null;

  const nav = (
    <FolderSidebar
      favorites={deriveFavoriteFolders(favoritePaths, folders, homeDirectory())}
      favoritePaths={favoritePaths}
      folderTree={folderTree}
      totals={totals}
    />
  );
  return (
    <>
      <aside className={`hidden shrink-0 lg:block ${SIDEBAR_WIDTH}`}>{nav}</aside>
      <FolderDisclosure className="lg:hidden" folderTree={folderTree} totals={totals}>
        {nav}
      </FolderDisclosure>
    </>
  );
}

/** The sidebar column's width, which its skeleton holds too, so the page does not jump sideways. */
const SIDEBAR_WIDTH = "lg:w-64 2xl:w-80";

/** The folder entries the sidebar skeleton draws, "All folders" included. */
const SKELETON_FOLDERS = 7;

/**
 * The sidebar's skeleton: the disclosure's one line below `lg`, the folder
 * column from `lg` up — each entry the real row's one line: the leading slot,
 * a label, then the count and cost columns, in the same gutters.
 */
function SidebarFallback() {
  return (
    <LoadingRegion label="Loading folders" className={`shrink-0 ${SIDEBAR_WIDTH}`}>
      <Skeleton className="h-12 rounded-xl lg:hidden" />
      <div className="hidden flex-col lg:flex">
        {Array.from({ length: SKELETON_FOLDERS }, (_, index) => (
          <div key={index} className="flex h-7 items-center">
            <SidebarLeadingSlot />
            <div className="flex min-w-0 flex-1 items-center gap-1.5 pr-7 pl-2">
              <span className="min-w-0 flex-1">
                <Skeleton className="h-3.5 w-28 max-w-full" />
              </span>
              <span className="hidden min-w-6 justify-end 2xl:flex">
                <Skeleton className="h-3 w-5" />
              </span>
              <span className={`${FOLDER_ROW_COST_COLUMN} flex justify-end`}>
                <Skeleton className="h-3 w-12" />
              </span>
            </div>
          </div>
        ))}
      </div>
    </LoadingRegion>
  );
}
