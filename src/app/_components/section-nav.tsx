"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils-cn";

const SECTIONS = [
  { href: "/", label: "Conversations" },
  { href: "/trends", label: "Trends" },
  { href: "/tools", label: "Tools" },
] as const;

const CARRIED_PARAMS = ["folder", "range"] as const;

export function SectionNav() {
  const pathname = usePathname();
  const params = useSearchParams();

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
