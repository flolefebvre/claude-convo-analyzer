import { Suspense } from "react";

import { FolderSidebar } from "@/app/_components/folder-sidebar";
import { RefreshButton } from "@/app/_components/refresh-button";
import { SearchBox } from "@/app/_components/search-box";
import { SectionNav } from "@/app/_components/section-nav";
import { ThemeToggle } from "@/app/_components/theme-toggle";
import { loadConversations } from "@/app/_lib/conversations";
import { buildListView } from "@/app/_lib/list-view";

export default function ShellLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <main className="mx-auto w-full max-w-7xl px-6 py-10">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Claude Conversation Analyzer</h1>
          <p className="text-sm text-muted-foreground">
            Every conversation from your local Claude Code logs, with token and cost rollups.
          </p>
        </div>
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
          <Suspense fallback={null}>
            <SectionNav />
          </Suspense>
          <Suspense fallback={<p className="text-sm text-muted-foreground">Loading folders…</p>}>
            <Sidebar />
          </Suspense>
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </main>
  );
}

async function Sidebar() {
  const allRows = await loadConversations();
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
