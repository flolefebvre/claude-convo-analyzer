import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";

import "./globals.css";
import { FolderSidebar } from "@/app/_components/folder-sidebar";
import { RefreshButton } from "@/app/_components/refresh-button";
import { ThemeProvider } from "@/app/_components/theme-provider";
import { ThemeToggle } from "@/app/_components/theme-toggle";
import { loadConversations } from "@/app/_lib/conversations";
import { deriveFolders } from "@/app/_lib/folders";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Claude Conversation Analyzer",
  description: "Browse and cost your local Claude Code conversations.",
};

// The persistent app shell (PR #13). The header + two-column sidebar/main grid
// live HERE in the layout, which does NOT re-render on navigation, so changing
// `?folder=`/sort no longer reloads/flashes the sidebar (ADR-0004 amendment).
// The page renders only the table region as `{children}`.
//
// The sidebar's folder list is scope-independent (derived from ALL
// conversations), so the layout can build it without reading `searchParams`
// (which layouts cannot do anyway). Both this and the page call
// `loadConversations()`, but React `cache()` dedupes it to one read per request.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      // The ThemeProvider's blocking script sets the `.dark` class on <html>
      // before hydration (no theme flash); suppress the resulting class mismatch
      // warning (ADR-0004 sanctions this deliberate client-JS exception).
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* The theme provider is a client boundary wrapping the otherwise-server
            tree: the page/table stay server components and PPR is unaffected. */}
        <ThemeProvider>
          <main className="mx-auto w-full max-w-7xl px-6 py-10">
            <header className="mb-6 flex items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">
                  Claude Conversation Analyzer
                </h1>
                <p className="text-sm text-muted-foreground">
                  Every conversation from your local Claude Code logs, with token
                  and cost rollups.
                </p>
              </div>
              {/* Header controls: the Light/Dark/Auto theme toggle and the
                  Refresh control. Both are client components; the layout stays a
                  server component. */}
              <div className="flex items-center gap-3">
                <ThemeToggle />
                <div data-slot="refresh-action">
                  <RefreshButton />
                </div>
              </div>
            </header>

            <div className="flex flex-col gap-6 md:flex-row md:items-start">
              <aside className="w-full shrink-0 md:w-64">
                {/* The sidebar reads the live URL (useSearchParams) for its active
                    highlight, and its folder list is fetched at request time — both
                    reasons to keep it inside a Suspense boundary so the shell can
                    prerender (Next local docs: use-search-params "Prerendering"). */}
                <Suspense
                  fallback={
                    <p className="text-sm text-muted-foreground">
                      Loading folders…
                    </p>
                  }
                >
                  <Sidebar />
                </Suspense>
              </aside>
              <div className="min-w-0 flex-1">{children}</div>
            </div>
          </main>
        </ThemeProvider>
      </body>
    </html>
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
  const folders = deriveFolders(allRows);
  return <FolderSidebar folders={folders} totalCount={allRows.length} />;
}
