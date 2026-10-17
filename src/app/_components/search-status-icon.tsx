"use client";

// The search box's leading icon, which turns into a spinner while the submitted
// search is in flight. It also carries the `data-link-pending` marker
// `PendingLink` uses, so the same globals.css rule dims `#main`: a refined
// query on `/search` keeps the old results up until the new ones land.
//
// ADR-0002: pure UI, no core import.

import { LoaderCircle, Search } from "lucide-react";
import { useFormStatus } from "react-dom";

import { cn } from "@/lib/utils-cn";

/**
 * The magnifier, or a spinner of the same size while the enclosing form is
 * pending; must render inside the `<Form>`.
 *
 * @example <SearchStatusIcon />
 */
export function SearchStatusIcon() {
  const { pending } = useFormStatus();
  const Icon = pending ? LoaderCircle : Search;
  return (
    <>
      <Icon
        className={cn(
          "pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground",
          pending && "animate-spin",
        )}
        aria-hidden
      />
      <span hidden data-link-pending={pending ? "" : undefined} />
    </>
  );
}
