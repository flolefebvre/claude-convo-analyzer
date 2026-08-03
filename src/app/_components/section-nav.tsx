"use client";

// The sidebar's section switcher (issue #41): the analysis surfaces sharing the
// shell — the conversation list, Trends, and Tools. A small client component,
// for the same reason as `SidebarLink`: it lives in the shell layout, which
// CANNOT read `searchParams`, so both things that depend on the live URL are
// decided here —
//   1. the active-section HIGHLIGHT (`usePathname`);
//   2. the link HREF, which carries the active `?folder=` scope and `?range=`
//      across the switch (`useSearchParams`), so changing surface never drops
//      the scope you are looking at.
//
// ADR-0002 boundary: no core import; no data of any kind flows through here.

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils-cn";

/** The shell's surfaces, in sidebar order. */
const SECTIONS = [
  { href: "/", label: "Conversations" },
  { href: "/trends", label: "Trends" },
  { href: "/tools", label: "Tools" },
] as const;

/** The view params worth carrying across a surface switch. */
const CARRIED_PARAMS = ["folder", "range"] as const;

export function SectionNav() {
  const pathname = usePathname();
  const params = useSearchParams();

  // Rebuild the query from the carried params only: `?sortBy=`/`?expanded=` are
  // list-table state and mean nothing on Trends (both surfaces default safely).
  const carried = new URLSearchParams();
  for (const key of CARRIED_PARAMS) {
    const value = params.get(key);
    if (value) carried.set(key, value);
  }
  const query = carried.toString();

  return (
    <nav aria-label="Sections" className="flex flex-col gap-1">
      {SECTIONS.map((section) => {
        const active = pathname === section.href;
        return (
          <Link
            key={section.href}
            href={query === "" ? section.href : `${section.href}?${query}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              // Same active language as the folder entries: a faint clay wash
              // with a clay left marker, so "where am I" reads identically in
              // both halves of the sidebar.
              "relative rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-cost-muted text-foreground before:absolute before:top-1/2 before:left-0 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-r before:bg-cost"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
