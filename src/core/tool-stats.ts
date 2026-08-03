// Tool-call analytics read API (issue #42, ADR-0002): "which tools do I use,
// which ones fail, and which ones flood my context?" — one aggregate per tool
// name over a folder- and date-scoped slice of the `tool_call` table.
//
// Split out of `read.ts` (already the conversation/transcript seam) so the
// tool-analytics surface owns its own module. Read-only, like `read.ts`, and
// free of any `next`/`react` import.
//
// Scoping mirrors `getDailySpend`: a `tool_call` has no timestamp of its own, so
// it inherits its turn's `message.timestamp`, bucketed by LOCAL day; a range of
// N days ends on today's local day (inclusive). Sub-agent tool calls are
// ordinary rows here and are therefore INCLUDED — they are the same friction.

import { readClient } from "@/core/db";
import { addLocalDays, startOfLocalDay } from "@/core/local-day";

/** One tool's aggregate over the scoped slice. */
export type ToolStat = {
  /** Tool name exactly as logged (`Bash`, `Skill`, `mcp__server__tool`, …). */
  name: string;
  /** Number of calls — every call, including those whose result never paired. */
  calls: number;
  /** Calls whose result came back an error. */
  errors: number;
  /** {@link errors} / {@link calls}, in `[0, 1]`. */
  errorRate: number;
  /** Calls that carry a result size — the denominator of the size stats. */
  sizedCalls: number;
  /** Mean result size in characters; `null` when no call has a size. */
  meanSize: number | null;
  /** Median (p50) result size, nearest rank; `null` when no call has a size. */
  p50Size: number | null;
  /** p95 result size, nearest rank; `null` when no call has a size. */
  p95Size: number | null;
  /** The single largest result; `null` when no call has a size. */
  maxSize: number | null;
  /** Summed result characters — the tool's total context volume (`0` when none). */
  totalSize: number;
};

/** Tool-call analytics over one folder + date scope. */
export type ToolStats = {
  /** One entry per tool name, call count descending (ties by name, ascending). */
  tools: ToolStat[];
  totalCalls: number;
  totalErrors: number;
  /** Summed result characters across every tool. */
  totalSize: number;
};

/** Scope of a tool-analytics read — the same axes as the Trends read. */
export type ToolStatsOptions = {
  /** Scope to one Project by its `folderName` (the `?folder=` key); all Projects when omitted. */
  folder?: string;
  /** Range length in days, ending today (inclusive). All time when omitted. */
  days?: number;
  /** Clock injection point — the instant "today" is derived from. Defaults to now. */
  now?: number;
  /** Additional (non-seam) opt for isolated DBs in refresh + tests. */
  dbPath?: string;
};

/**
 * Per-tool call analytics for the Tools view: calls, errors, and result-size
 * distribution per tool name over the scoped slice.
 *
 * Two deliberate row policies:
 *  - a call whose turn has NO timestamp is EXCLUDED — it cannot be scoped;
 *  - a call with a NULL `result_char_size` (an unpaired result, or one the
 *    parser never saw) COUNTS as a call and as an error if it errored, but is
 *    excluded from every size statistic — mean, p50, p95, largest and total are
 *    computed over sized calls only, and are `null` when a tool has none.
 *
 * Percentiles use the NEAREST-RANK definition on the ascending sizes — p_k is
 * the value at index `ceil(k · n) - 1` — never interpolated, so a reported p95
 * is always a result size that actually occurred.
 */
export async function getToolStats(
  opts: ToolStatsOptions = {},
): Promise<ToolStats> {
  const { prisma, owned } = readClient(opts.dbPath);
  try {
    const rows = await prisma.toolCall.findMany({
      where: scopeWhere(opts),
      select: { name: true, isError: true, resultCharSize: true },
    });
    return assembleToolStats(rows);
  } finally {
    // Only a caller-owned (non-default) client is disconnected; the shared
    // default singleton stays open for the next request.
    if (owned) await prisma.$disconnect();
  }
}

/** One `tool_call` row as read for the aggregate. */
type ToolCallRow = {
  name: string;
  isError: boolean;
  resultCharSize: number | null;
};

/** Mutable per-tool accumulator; sizes are collected for the percentiles. */
type Accumulator = {
  name: string;
  calls: number;
  errors: number;
  sizes: number[];
};

/** Fold the scoped rows into one entry per tool name, ranked and rolled up. */
function assembleToolStats(rows: ToolCallRow[]): ToolStats {
  const byName = new Map<string, Accumulator>();
  for (const row of rows) {
    let acc = byName.get(row.name);
    if (acc === undefined) {
      acc = { name: row.name, calls: 0, errors: 0, sizes: [] };
      byName.set(row.name, acc);
    }
    acc.calls += 1;
    if (row.isError) acc.errors += 1;
    // NULL size: the call counts above, but never enters the size stats.
    if (row.resultCharSize !== null) acc.sizes.push(row.resultCharSize);
  }

  const tools = [...byName.values()].map(summarize).sort(byCallsDesc);
  return {
    tools,
    totalCalls: tools.reduce((sum, t) => sum + t.calls, 0),
    totalErrors: tools.reduce((sum, t) => sum + t.errors, 0),
    totalSize: tools.reduce((sum, t) => sum + t.totalSize, 0),
  };
}

/** Turn one accumulator into its public stat (sizes sorted for the percentiles). */
function summarize(acc: Accumulator): ToolStat {
  const sizes = [...acc.sizes].sort((a, b) => a - b);
  const totalSize = sizes.reduce((sum, size) => sum + size, 0);
  const sized = sizes.length > 0;
  return {
    name: acc.name,
    calls: acc.calls,
    errors: acc.errors,
    errorRate: acc.calls === 0 ? 0 : acc.errors / acc.calls,
    sizedCalls: sizes.length,
    meanSize: sized ? totalSize / sizes.length : null,
    p50Size: sized ? percentile(sizes, 0.5) : null,
    p95Size: sized ? percentile(sizes, 0.95) : null,
    maxSize: sized ? sizes[sizes.length - 1] : null,
    totalSize,
  };
}

/**
 * Nearest-rank percentile of ASCENDING `sizes` (non-empty): the value at index
 * `ceil(k · n) - 1`. No interpolation — the answer is always an observed size.
 */
function percentile(sizes: number[], k: number): number {
  const index = Math.min(sizes.length - 1, Math.max(0, Math.ceil(k * sizes.length) - 1));
  return sizes[index];
}

/** Call count descending; ties broken by name so the order is deterministic. */
function byCallsDesc(a: ToolStat, b: ToolStat): number {
  if (a.calls !== b.calls) return b.calls - a.calls;
  return a.name.localeCompare(b.name);
}

/**
 * The Prisma `where` for a scope: the call's own turn carries the timestamp and
 * the Project, so both axes are one nested filter on `message`. A NULL timestamp
 * never satisfies a comparison, which is exactly the "cannot be scoped →
 * excluded" policy.
 */
function scopeWhere(opts: ToolStatsOptions) {
  const today = startOfLocalDay(opts.now ?? Date.now());
  // `days` counts back from today inclusive: 7 days = today and the 6 before.
  const from = opts.days === undefined ? null : addLocalDays(today, 1 - opts.days);
  return {
    message: {
      timestamp: {
        lt: BigInt(addLocalDays(today, 1).getTime()),
        ...(from === null ? {} : { gte: BigInt(from.getTime()) }),
      },
      ...(opts.folder === undefined
        ? {}
        : { conversation: { project: { folderName: opts.folder } } }),
    },
  };
}
