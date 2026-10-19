// The app bar: the one header on every route — the list, Trends, Tools, search
// results, a transcript, the 404 page. Brand, section tabs, search, theme, Live
// and Refresh always sit in the same places at the same width, so moving between
// surfaces never rearranges the chrome. Rendered once, by the root layout.
//
// Responsive by reordering one flex row rather than rendering twice:
//   phone    brand ······ theme live refresh   (Live and Refresh shrink to their icons)
//            search ─────────────────────────
//            tabs
//   tablet   brand ···· search theme live refresh
//            tabs
//   desktop  brand  tabs ···· search theme live refresh      (one 56px row)
// The tabs always end flush on the bar's bottom border, where the active tab's
// clay underline sits.
//
// A server component: the URL-dependent pieces (active tab, the search box's
// query) are client leaves inside their own <Suspense>, so the bar prerenders.
// So are the current Live and Refresh controls, which read Live and the running
// Refresh per request; their fallbacks are the off toggle and the idle button,
// so the shell always has both controls.

import Link from "next/link";
import { Suspense } from "react";

import { CurrentLiveToggle } from "@/app/_components/current-live-toggle";
import { CurrentRefreshButton } from "@/app/_components/current-refresh-button";
import { InertLiveToggle } from "@/app/_components/live-toggle";
import { IdleRefreshButton } from "@/app/_components/refresh-button";
import { SearchBox } from "@/app/_components/search-box";
import { SectionNav, SectionTabs } from "@/app/_components/section-nav";
import { ThemeToggle } from "@/app/_components/theme-toggle";

/**
 * The global header (`<header>` landmark) with the app's navigation and
 * controls.
 *
 * @example <AppBar />
 */
export function AppBar() {
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 pt-2 sm:px-6 lg:flex-nowrap lg:gap-x-6 lg:pt-0">
        <Brand className="order-1 mr-auto lg:mr-0" />
        <Suspense fallback={<SectionTabs className={TABS_CLASS} />}>
          <SectionNav className={TABS_CLASS} />
        </Suspense>
        <SearchBox className="order-4 w-full md:order-2 md:w-60 lg:order-3 lg:ml-auto" />
        <div className="order-2 flex items-center gap-2 md:order-3 lg:order-4">
          <ThemeToggle />
          <Suspense fallback={<InertLiveToggle />}>
            <CurrentLiveToggle />
          </Suspense>
          <Suspense fallback={<IdleRefreshButton variant="outline" collapsible />}>
            <CurrentRefreshButton variant="outline" collapsible reportsOutcome />
          </Suspense>
        </div>
      </div>
    </header>
  );
}

/** The tabs' slot in the reordered row: last and full width until desktop. */
const TABS_CLASS = "order-5 -ml-2.5 w-full lg:order-2 lg:w-auto lg:self-stretch";

/** The app's mark and name, linking home. Not a heading: each page owns its h1. */
function Brand({ className }: { className?: string }) {
  return (
    <Link href="/" className={`flex h-8 shrink-0 items-center gap-2 rounded-md ${className ?? ""}`}>
      <BrandMark />
      <span className="text-sm font-semibold tracking-tight">
        <span className="max-sm:hidden">Claude </span>Conversation Analyzer
      </span>
    </Link>
  );
}

/** The favicon's four ascending clay cost bars, drawn inline so they follow the theme. */
function BrandMark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className="size-6 shrink-0">
      <rect width="32" height="32" rx="7" className="fill-foreground dark:fill-muted" />
      <g className="fill-cost">
        <rect x="5" y="16.5" width="4" height="8" rx="2" />
        <rect x="11" y="12.5" width="4" height="12" rx="2" />
        <rect x="17" y="9.5" width="4" height="15" rx="2" />
        <rect x="23" y="6.5" width="4" height="18" rx="2" />
      </g>
    </svg>
  );
}
