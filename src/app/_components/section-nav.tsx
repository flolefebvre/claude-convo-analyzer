"use client";

// The app bar's section tabs: the analysis surfaces — the conversation list,
// Trends and Tools — reachable from every route. A client component because two
// things depend on the live URL, which the root layout cannot read:
//   1. the active tab (`usePathname`);
//   2. the tab HREF, which carries the active `?folder=` scope and `?range=`
//      across the switch (`useSearchParams`), so changing surface never drops
//      the scope you are looking at.
// Off the shell (a transcript, search results) no tab is active and nothing is
// carried: the tabs are plain links back into the surfaces.
//
// ADR-0002 boundary: no core import; no data of any kind flows through here.

import { usePathname, useSearchParams } from "next/navigation";

import { PendingLink } from "@/app/_components/pending-link";
import { cn } from "@/lib/utils-cn";

/** The shell's surfaces, in tab order. */
const SECTIONS = [
  { href: "/", label: "Conversations" },
  { href: "/trends", label: "Trends" },
  { href: "/tools", label: "Tools" },
] as const;

/** The view params worth carrying across a surface switch. */
const CARRIED_PARAMS = ["folder", "range"] as const;

/**
 * The section tabs, active and scope-carrying from the live URL. Reads the URL,
 * so it renders inside a `<Suspense>` whose fallback is {@link SectionTabs}.
 */
export function SectionNav({ className }: { className?: string }) {
  const pathname = usePathname();
  const params = useSearchParams();

  // Rebuild the query from the carried params only: `?sortBy=`/`?expanded=` are
  // per-surface table state and mean nothing on the next surface.
  const carried = new URLSearchParams();
  for (const key of CARRIED_PARAMS) {
    const value = params.get(key);
    if (value) carried.set(key, value);
  }

  return <SectionTabs active={pathname} query={carried.toString()} className={className} />;
}

/**
 * The tabs themselves, from an already-known path and carried query. With no
 * arguments it renders the URL-independent tabs (no active tab, nothing
 * carried) — the prerendered fallback of {@link SectionNav}.
 *
 * @example <SectionTabs className="w-full" />
 */
export function SectionTabs({
  active,
  query = "",
  className,
}: {
  /** The current pathname; the matching tab is marked current. */
  active?: string;
  /** The query string carried onto every tab, without the `?`. */
  query?: string;
  className?: string;
}) {
  return (
    <nav aria-label="Sections" className={cn("flex items-stretch gap-1", className)}>
      {SECTIONS.map((section) => {
        const isActive = active === section.href;
        return (
          <PendingLink
            key={section.href}
            href={query === "" ? section.href : `${section.href}?${query}`}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              // An underline tab: the clay bar sits on the app bar's bottom
              // border. A tab whose navigation is in flight shows a fainter bar
              // straight away, so the click is acknowledged before the page lands.
              "relative inline-flex h-10 items-center rounded-md px-2.5 text-sm font-medium focus-inset transition-colors lg:h-14",
              "after:absolute after:inset-x-2.5 after:-bottom-px after:h-0.5 after:rounded-full",
              isActive
                ? "text-foreground after:bg-cost"
                : "text-muted-foreground hover:text-foreground has-data-link-pending:text-foreground has-data-link-pending:after:bg-cost/50",
            )}
          >
            {section.label}
          </PendingLink>
        );
      })}
    </nav>
  );
}
