"use client";

// The Disk usage item in the app bar, beside Live and Refresh: a popover with
// how much disk the database and the Claude Code logs take, each with its path
// to copy. Each open measures through `GET /api/disk-usage`; never on first
// paint, since walking a multi-GB logs root takes a while. Client-only, with
// nothing read per request, so the static shell draws it as it is.

import { callRoute } from "@flefebvre/next-pipe/client";
import { HardDrive } from "lucide-react";
import { useState } from "react";

import { CopyButton } from "@/app/_components/copy-button";
import { formatBytes } from "@/app/_lib/format";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { routes } from "@/generated/routes";
import { cn } from "@/lib/utils-cn";

/** A path the app keeps data in, and its size on disk, as `GET /api/disk-usage` answered. */
type PathUsageAsRead = { path: string; bytes: number };

/** The popover's state: measuring, measured, or the measurement failed. */
type DiskUsageAsRead =
  | { state: "measuring" }
  | { state: "measured"; database: PathUsageAsRead; logs: PathUsageAsRead }
  | { state: "failed" };

/**
 * The Disk usage item: a button opening the sizes on disk of the database and
 * the Claude Code logs, measured on each open. Its label collapses below 1280px.
 *
 * @example <DiskUsageItem />
 */
export function DiskUsageItem() {
  const [diskUsage, setDiskUsage] = useState<DiskUsageAsRead>({ state: "measuring" });

  async function measureDiskUsage() {
    setDiskUsage({ state: "measuring" });
    try {
      const response = await callRoute(routes.api["disk-usage"].GET());
      setDiskUsage(response.status === 200 ? { state: "measured", ...response.json } : { state: "failed" });
    } catch {
      setDiskUsage({ state: "failed" });
    }
  }

  return (
    <Popover
      onOpenChange={(isOpen) => {
        if (isOpen) void measureDiskUsage();
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" title="Disk usage" className="max-xl:w-8 max-xl:px-0">
          <HardDrive aria-hidden className="text-muted-foreground" />
          <span className="max-xl:sr-only">Disk usage</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="max-h-(--radix-popover-content-available-height) w-[min(24rem,calc(100vw-2rem))] gap-3 overflow-y-auto p-3 text-xs"
      >
        <DiskUsageSection diskUsage={diskUsage} />
      </PopoverContent>
    </Popover>
  );
}

/** How much disk the database and the Claude Code logs take, each with its path to copy. */
function DiskUsageSection({ diskUsage }: { diskUsage: DiskUsageAsRead }) {
  const usageOf = (key: "database" | "logs") => (diskUsage.state === "measured" ? diskUsage[key] : null);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">Disk usage</p>
      {diskUsage.state === "failed" ? (
        <p className="text-destructive">The sizes could not be measured.</p>
      ) : (
        <>
          <PathUsageLine label="Database" pathUsage={usageOf("database")} />
          <PathUsageLine label="Claude Code logs" pathUsage={usageOf("logs")} />
          <p className="text-muted-foreground">The app reads these and never deletes them.</p>
        </>
      )}
    </div>
  );
}

/** One Disk usage line: its label and size, then its path to copy; "measuring…" until `pathUsage` is read. */
function PathUsageLine({ label, pathUsage }: { label: string; pathUsage: PathUsageAsRead | null }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="flex justify-between gap-3">
        <span>{label}</span>
        <span className={cn("tabular-nums", pathUsage === null && "text-muted-foreground")}>
          {pathUsage === null ? "measuring…" : formatBytes(pathUsage.bytes)}
        </span>
      </p>
      {pathUsage !== null && <CopyableLine text={pathUsage.path} />}
    </div>
  );
}

/** A path, with a button putting it on the clipboard. */
function CopyableLine({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-1 rounded-md bg-muted py-1 pr-1 pl-2">
      <code className="min-w-0 flex-1 overflow-x-auto font-mono text-[11px] whitespace-nowrap">{text}</code>
      <CopyButton text={text} className="shrink-0" />
    </div>
  );
}
