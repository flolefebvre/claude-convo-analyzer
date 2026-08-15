import Link from "next/link";

import { ExpandToggle } from "@/app/_components/expand-toggle";
import { formatChars, formatClock } from "@/app/_lib/format";
import { toolLabel } from "@/app/_lib/tools";
import { toolCallHref } from "@/app/_lib/transcript-url";
import { TableCell, TableRow } from "@/components/ui/table";
import type { ToolCallSample, ToolCallSamples, ToolStat } from "@/core/tool-stats";

const TOOL_COLUMN_COUNT = 8;

export function ToolRow({
  tool,
  expanded = false,
  samples = null,
  toggleHref,
}: {
  tool: ToolStat;
  expanded?: boolean;
  samples?: ToolCallSamples | null;
  toggleHref: string;
}) {
  const label = toolLabel(tool.name);

  return (
    <>
      <TableRow>
        <TableCell className="font-medium">
          <ExpandToggle href={toggleHref} expanded={expanded} label="tool details">
            {label.server !== null && (
              <span className="text-muted-foreground">
                {label.server}
                <span aria-hidden> · </span>
              </span>
            )}
            {label.tool}
          </ExpandToggle>
        </TableCell>

        <TableCell className="text-right tabular-nums">{tool.calls}</TableCell>

        <TableCell className="text-right tabular-nums">
          {tool.errors === 0 ? (
            <span className="text-muted-foreground">0</span>
          ) : (
            <span className="font-medium text-destructive">
              {tool.errors}
              <span className="ml-1.5 text-xs font-normal">{formatRate(tool.errorRate)}</span>
            </span>
          )}
        </TableCell>

        <TableCell className="text-right text-muted-foreground tabular-nums">
          {formatChars(tool.meanSize === null ? null : Math.round(tool.meanSize))}
        </TableCell>
        <TableCell className="text-right text-muted-foreground tabular-nums">{formatChars(tool.p50Size)}</TableCell>
        <TableCell className="text-right tabular-nums">{formatChars(tool.p95Size)}</TableCell>
        <TableCell className="text-right text-muted-foreground tabular-nums">{formatChars(tool.maxSize)}</TableCell>
        <TableCell className="text-right font-medium tabular-nums">{formatChars(tool.totalSize)}</TableCell>
      </TableRow>

      {expanded && (
        <TableRow>
          <TableCell colSpan={TOOL_COLUMN_COUNT} className="bg-muted/30 p-0">
            <DrillDown tool={tool} samples={samples} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function formatRate(rate: number): string {
  const pct = rate * 100;
  return `${pct >= 10 ? Math.round(pct) : Math.round(pct * 10) / 10}%`;
}

function DrillDown({ tool, samples }: { tool: ToolStat; samples: ToolCallSamples | null }) {
  if (samples === null) {
    return <p className="px-6 py-5 text-sm text-muted-foreground">No detail available for this tool.</p>;
  }

  return (
    <div className="space-y-6 px-6 py-5">
      <div className="grid gap-x-10 gap-y-6 lg:grid-cols-2">
        <Section
          title="Most recent errors"
          empty={`No errors — ${tool.calls} clean call${tool.calls === 1 ? "" : "s"}.`}
          samples={samples.recentErrors}
        />
        <Section title="Largest results" empty="No sized results in this range." samples={samples.largestResults} />
      </div>

      {samples.breakdown.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {tool.name === "Agent" ? "By sub-agent" : "By skill"}
          </p>
          <ul className="flex flex-wrap gap-x-6 gap-y-1.5 text-sm">
            {samples.breakdown.map((entry) => (
              <li key={entry.key} className="flex items-baseline gap-2">
                <span className="font-medium">{entry.key}</span>
                <span className="text-muted-foreground tabular-nums">
                  {entry.calls} call{entry.calls === 1 ? "" : "s"}
                </span>
                {entry.errors > 0 && (
                  <span className="text-destructive tabular-nums">
                    {entry.errors} error{entry.errors === 1 ? "" : "s"}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Section({ title, empty, samples }: { title: string; empty: string; samples: ToolCallSample[] }) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</p>
      {samples.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {samples.map((sample, i) => (
            <SampleItem key={`${sample.toolUseId ?? "call"}-${i}`} sample={sample} />
          ))}
        </ul>
      )}
    </div>
  );
}

function SampleItem({ sample }: { sample: ToolCallSample }) {
  const time = formatClock(sample.timestamp);
  return (
    <li className="min-w-0 text-sm">
      <Link
        href={toolCallHref(sample.sessionId, sample.agentId, sample.toolUseId)}
        className="block rounded-md border bg-card px-3 py-2 transition-colors outline-none hover:border-foreground/20 focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate font-medium">{sample.conversationTitle ?? sample.sessionId}</span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {formatChars(sample.charSize)}
            {time && <span className="ml-2">{time}</span>}
          </span>
        </div>
        {sample.excerpt && (
          <p
            className={`mt-1 truncate font-mono text-xs ${
              sample.isError ? "text-destructive" : "text-muted-foreground"
            }`}
          >
            {sample.excerpt}
          </p>
        )}
      </Link>
    </li>
  );
}
