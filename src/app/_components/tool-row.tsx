// The expandable Tools-table row (issue #42). A SERVER component, mirroring
// `ConversationRow`: whether a row is expanded is URL view state
// (`?expanded=<tool>`), so the page resolves it from `searchParams`, fetches the
// drill-down server-side, and hands both down as plain props. The toggle is the
// shared `ExpandToggle`, the same chevron link the conversation list uses.
//
// ADR-0002 boundary: no client file touches core; core types are type-only
// imports here.

import Link from "next/link";
import { Fragment } from "react";

import { ExpandToggle } from "@/app/_components/expand-toggle";
import { formatChars, formatCount, formatDate, formatRate } from "@/app/_lib/format";
import { toolLabel } from "@/app/_lib/tools";
import { toolCallHref } from "@/app/_lib/transcript-url";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils-cn";
import type { ToolCallSample, ToolCallSamples, ToolStat } from "@/core/tool-stats";

/**
 * Width and visibility of each Tools column, shared by the header, the rows and
 * the footer. The table's wrapper is the `@container`: below `@xl` only the
 * tool, calls, error rate and volume fit; `@xl` adds the error count and p95,
 * `@3xl` the rest of the size distribution. The tool column takes what is left,
 * and the first and last columns get the card's inset.
 */
export const TOOL_COLUMNS = {
  tool: "w-full pl-4",
  calls: "w-16 @xl:w-20",
  errors: "hidden w-20 @xl:table-cell",
  errorRate: "w-20 @xl:w-24",
  mean: "hidden w-20 @3xl:table-cell",
  p50: "hidden w-20 @3xl:table-cell",
  p95: "hidden w-20 @xl:table-cell",
  largest: "hidden w-20 @3xl:table-cell",
  volume: "w-20 pr-4 @xl:w-24",
} as const;

/** How many columns the table has — the colspan of an expanded panel. */
const TOOL_COLUMN_COUNT = Object.keys(TOOL_COLUMNS).length;

/**
 * One tool as a table row, plus its drill-down panel row when expanded.
 *
 * @example <ToolRow tool={tool} expanded={false} toggleHref={toolExpandHref(tool.name, state)} now={now} />
 */
export function ToolRow({
  tool,
  expanded = false,
  samples = null,
  toggleHref,
  now,
}: {
  tool: ToolStat;
  /** True when this row is the URL's `?expanded=` target. */
  expanded?: boolean;
  /** The server-fetched drill-down (`null` while collapsed). */
  samples?: ToolCallSamples | null;
  toggleHref: string;
  /** The request time the drill-down's dates are relative to. */
  now: Date;
}) {
  const label = toolLabel(tool.name);
  const size = (n: number | null) => formatChars(n, { fixed: true });

  return (
    <>
      {/* No row hover wash: only the toggle is a target (as in the conversation list). */}
      <TableRow className="hover:bg-transparent">
        <TableCell className={cn(TOOL_COLUMNS.tool, "font-medium whitespace-normal")}>
          <ExpandToggle href={toggleHref} expanded={expanded} label="tool details">
            {/* An MCP tool reads "server · tool", so a misbehaving server is
                spottable by eye without grouping the table; in a narrow table
                the server takes its own line and the tool breaks after an
                underscore rather than mid-word. */}
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {label.server !== null && (
                <span className="block text-xs text-muted-foreground @xl:inline @xl:text-sm">
                  {label.server}
                  <span aria-hidden className="hidden @xl:inline">
                    {" "}
                    ·{" "}
                  </span>
                </span>
              )}
              {breakAfterUnderscores(label.tool)}
            </span>
          </ExpandToggle>
        </TableCell>

        <TableCell className={cn(TOOL_COLUMNS.calls, "text-right")}>{formatCount(tool.calls)}</TableCell>
        <TableCell className={cn(TOOL_COLUMNS.errors, "text-right", tool.errors === 0 && "text-muted-foreground")}>
          {formatCount(tool.errors)}
        </TableCell>
        {/* The rate is what the column sorts by, so it is the figure that stands out. */}
        <TableCell
          className={cn(
            TOOL_COLUMNS.errorRate,
            "text-right",
            tool.errors === 0 ? "text-muted-foreground" : "font-medium text-destructive-foreground",
          )}
        >
          {formatRate(tool.errorRate)}
        </TableCell>

        <TableCell className={cn(TOOL_COLUMNS.mean, "text-right text-muted-foreground")}>
          {size(tool.meanSize === null ? null : Math.round(tool.meanSize))}
        </TableCell>
        <TableCell className={cn(TOOL_COLUMNS.p50, "text-right text-muted-foreground")}>{size(tool.p50Size)}</TableCell>
        <TableCell className={cn(TOOL_COLUMNS.p95, "text-right")}>{size(tool.p95Size)}</TableCell>
        <TableCell className={cn(TOOL_COLUMNS.largest, "text-right text-muted-foreground")}>
          {size(tool.maxSize)}
        </TableCell>
        <TableCell className={cn(TOOL_COLUMNS.volume, "text-right font-medium")}>{size(tool.totalSize)}</TableCell>
      </TableRow>

      {expanded && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={TOOL_COLUMN_COUNT} className="bg-muted/30 p-0 whitespace-normal">
            <DrillDown tool={tool} samples={samples} now={now} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/** A snake_case name with a line-break opportunity after each underscore. */
function breakAfterUnderscores(name: string): React.ReactNode {
  const parts = name.split("_");
  return parts.map((part, i) => (
    <Fragment key={i}>
      {part}
      {i < parts.length - 1 && (
        <>
          _<wbr />
        </>
      )}
    </Fragment>
  ));
}

/**
 * The drill-down panel: the tool's most recent errors and biggest results — the
 * two ways a tool hurts — plus, for `Skill`/`Agent`, what the calls were spent
 * on. Every sample deep-links into the Transcript, anchored on the call itself.
 * The two lists sit side by side only when the PANEL is wide enough (a
 * container query: the sidebar makes the viewport a poor guide).
 */
function DrillDown({ tool, samples, now }: { tool: ToolStat; samples: ToolCallSamples | null; now: Date }) {
  if (samples === null) {
    return <p className="px-4 py-5 text-sm text-muted-foreground">No detail available for this tool.</p>;
  }

  return (
    <div className="@container space-y-6 px-4 py-5">
      <div className="grid gap-x-8 gap-y-6 @3xl:grid-cols-2">
        <Section
          title="Most recent errors"
          empty={`No errors — ${formatCount(tool.calls)} clean call${tool.calls === 1 ? "" : "s"}.`}
          samples={samples.recentErrors}
          now={now}
        />
        <Section
          title="Largest results"
          empty="No sized results in this range."
          samples={samples.largestResults}
          now={now}
        />
      </div>

      {samples.breakdown.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium text-foreground">
            {tool.name === "Agent" ? "By sub-agent" : "By skill"}
          </p>
          <ul className="flex flex-wrap gap-x-6 gap-y-1.5 text-sm">
            {samples.breakdown.map((entry) => (
              <li key={entry.key} className="flex items-baseline gap-2">
                <span className="font-medium">{entry.key}</span>
                <span className="text-muted-foreground">
                  {formatCount(entry.calls)} call{entry.calls === 1 ? "" : "s"}
                </span>
                {entry.errors > 0 && (
                  <span className="text-destructive-foreground">
                    {formatCount(entry.errors)} error{entry.errors === 1 ? "" : "s"}
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

/** One drill-down list (errors or largest results), or its empty note. */
function Section({
  title,
  empty,
  samples,
  now,
}: {
  title: string;
  empty: string;
  samples: ToolCallSample[];
  now: Date;
}) {
  return (
    <section className="min-w-0">
      <h3 className="mb-2 text-sm font-medium text-foreground">{title}</h3>
      {samples.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {samples.map((sample, i) => (
            <SampleItem key={`${sample.toolUseId ?? "call"}-${i}`} sample={sample} now={now} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** One sampled call: its conversation, result size and date, the result excerpt, and the deep link. */
function SampleItem({ sample, now }: { sample: ToolCallSample; now: Date }) {
  const date = formatDate(sample.timestamp, now);
  return (
    <li className="min-w-0 text-sm">
      <Link
        href={toolCallHref(sample.sessionId, sample.agentId, sample.toolUseId)}
        className="block rounded-md border bg-card px-3 py-2 transition-colors hover:border-foreground/20"
      >
        {/* The meta wraps under the title rather than squeezing it to a few words. */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="min-w-0 flex-1 basis-48 truncate font-medium">
            {sample.conversationTitle ?? sample.sessionId}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {sample.charSize !== null && <>{formatChars(sample.charSize)} chars · </>}
            <time dateTime={sample.timestamp ?? undefined} title={date.absolute}>
              {date.label}
            </time>
          </span>
        </div>
        {sample.excerpt && (
          <p
            className={`mt-1 truncate font-mono text-xs ${
              sample.isError ? "text-destructive-foreground" : "text-muted-foreground"
            }`}
          >
            {sample.excerpt}
          </p>
        )}
      </Link>
    </li>
  );
}
