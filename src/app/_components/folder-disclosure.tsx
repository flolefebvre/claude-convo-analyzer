"use client";

// The folder list on phones and tablets: one line naming the current scope
// ("Folder  acme-api  $12.40"), which opens to the same entries the desktop
// sidebar shows. A native <details>, so it works without JavaScript — the URL is
// the state, and every entry is a plain link.
//
// A client component only to name the active folder in the summary: the shell
// layout cannot read `searchParams`. The disclosure is keyed by that folder, so
// picking an entry lands on a closed disclosure naming the new scope.
//
// ADR-0002 boundary: no core import — the labels and formatted costs arrive as
// props.

import { ChevronDown, Folder } from "lucide-react";
import { useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils-cn";

/**
 * The collapsible folder picker shown below `lg`, wrapping the folder `<nav>`.
 *
 * @example
 * <FolderDisclosure folders={[{ folder: "-acme", label: "acme", cost: "$3.10" }]} totalCost="$3.10">
 *   {nav}
 * </FolderDisclosure>
 */
export function FolderDisclosure({
  folders,
  totalCost,
  className,
  children,
}: {
  /** Each Project's `?folder=` key, label and formatted cost. */
  folders: { folder: string; label: string; cost: string }[];
  /** The formatted cost across all Projects. */
  totalCost: string;
  className?: string;
  /** The folder navigation, shown when open. */
  children: React.ReactNode;
}) {
  const params = useSearchParams();
  const activeFolder = params.get("folder") || null;
  const active = folders.find((entry) => entry.folder === activeFolder);

  return (
    <details key={activeFolder ?? ""} className={cn("group rounded-xl border bg-card", className)}>
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-4 py-3 text-sm [&::-webkit-details-marker]:hidden">
        <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="text-muted-foreground">Folder</span>
        <span className="min-w-0 truncate font-medium">{active?.label ?? "All folders"}</span>
        <span className="ml-auto shrink-0 text-muted-foreground">{active?.cost ?? totalCost}</span>
        <ChevronDown
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="max-h-[60vh] overflow-y-auto border-t p-2">{children}</div>
    </details>
  );
}
