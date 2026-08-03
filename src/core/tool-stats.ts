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

/** One sampled tool call — enough to render it and deep-link into its Transcript. */
export type ToolCallSample = {
  /** Session id of the conversation the call ran in (the transcript route key). */
  sessionId: string;
  /** Conversation title, when the log recorded one. */
  conversationTitle: string | null;
  /** The `?agent=` key of the agent that made the call (sub-agents included). */
  agentId: string;
  /** `tool_use` block id — the in-transcript anchor (`?call=`); null when unlogged. */
  toolUseId: string | null;
  /** The turn's timestamp as an ISO string (null when absent). */
  timestamp: string | null;
  /** Full result length in characters; null when the result never paired. */
  charSize: number | null;
  isError: boolean;
  /** Full tool input, serialized JSON — the app extracts its own snippet. */
  inputJson: string;
  /** First {@link EXCERPT_CHARS} characters of the result (the error message, typically). */
  excerpt: string | null;
};

/** One slice of a Skill/Agent drill-down: a skill name or sub-agent type. */
export type ToolBreakdownEntry = {
  /** The skill name / sub-agent type, or {@link UNKNOWN_KEY} when the input carried none. */
  key: string;
  calls: number;
  errors: number;
};

/** One tool's drill-down: its worst calls plus, for Skill/Agent, a breakdown. */
export type ToolCallSamples = {
  /** The tool name the samples belong to (as logged). */
  name: string;
  /** The tool's most recent errors, newest first. */
  recentErrors: ToolCallSample[];
  /** The tool's biggest results, largest first (errors included). */
  largestResults: ToolCallSample[];
  /**
   * For `Skill` (by `input.skill`) and `Agent` (by `input.subagent_type`): one
   * entry per skill/sub-agent type, calls descending. Empty for every other
   * tool — one row per tool name is the whole story there.
   */
  breakdown: ToolBreakdownEntry[];
};

/** How many calls each drill-down list holds by default. */
const DEFAULT_SAMPLE_LIMIT = 5;

/** How much of a result the drill-down shows inline. */
const EXCERPT_CHARS = 240;

/** Breakdown bucket for a call whose input carried no usable key. */
const UNKNOWN_KEY = "unknown";

/** Which input field names a call's breakdown bucket, per tool. */
const BREAKDOWN_FIELD: Record<string, string> = {
  Skill: "skill",
  Agent: "subagent_type",
};

export type ToolCallSamplesOptions = ToolStatsOptions & {
  /** How many calls each list holds (default {@link DEFAULT_SAMPLE_LIMIT}). */
  limit?: number;
};

/**
 * The drill-down behind one row of the Tools table, over the SAME scope as
 * {@link getToolStats}: the tool's most recent errors and its largest results —
 * each carrying the session, agent and `tool_use` id a Transcript deep-link
 * needs — plus, for `Skill` and `Agent`, a per-skill / per-sub-agent-type
 * breakdown of calls and errors.
 *
 * Fetched only when a row is expanded, so the table itself never pays for it.
 */
export async function getToolCallSamples(
  name: string,
  opts: ToolCallSamplesOptions = {},
): Promise<ToolCallSamples> {
  const limit = opts.limit ?? DEFAULT_SAMPLE_LIMIT;
  const { prisma, owned } = readClient(opts.dbPath);
  try {
    const rows = await prisma.toolCall.findMany({
      where: { name, ...scopeWhere(opts) },
      select: {
        toolUseId: true,
        inputJson: true,
        resultText: true,
        resultCharSize: true,
        isError: true,
        agent: { select: { id: true, externalAgentId: true } },
        message: {
          select: {
            timestamp: true,
            conversation: { select: { sessionId: true, title: true } },
          },
        },
      },
    });

    const samples = rows.map(toSample);
    return {
      name,
      recentErrors: samples
        .filter((s) => s.isError)
        .sort(byRecencyDesc)
        .slice(0, limit),
      largestResults: samples
        .filter((s) => s.charSize !== null)
        .sort(bySizeDesc)
        .slice(0, limit),
      breakdown: breakdownFor(name, rows),
    };
  } finally {
    // Only a caller-owned (non-default) client is disconnected; the shared
    // default singleton stays open for the next request.
    if (owned) await prisma.$disconnect();
  }
}

/** One `tool_call` row as read for the drill-down. */
type SampleRow = {
  toolUseId: string | null;
  inputJson: string;
  resultText: string | null;
  resultCharSize: number | null;
  isError: boolean;
  agent: { id: number; externalAgentId: string | null };
  message: {
    timestamp: bigint | number | null;
    conversation: { sessionId: string; title: string | null };
  } | null;
};

/** Shape one row into a sample (agent key + ISO timestamp + result excerpt). */
function toSample(row: SampleRow): ToolCallSample {
  const ts = row.message?.timestamp ?? null;
  return {
    sessionId: row.message?.conversation.sessionId ?? "",
    conversationTitle: row.message?.conversation.title ?? null,
    // The transcript's `?agent=` key — the same rule as `getTranscript`'s tree.
    agentId: row.agent.externalAgentId ?? String(row.agent.id),
    toolUseId: row.toolUseId,
    timestamp: ts === null ? null : new Date(Number(ts)).toISOString(),
    charSize: row.resultCharSize,
    isError: row.isError,
    inputJson: row.inputJson,
    excerpt: row.resultText === null ? null : row.resultText.slice(0, EXCERPT_CHARS),
  };
}

/** Newest first; ties broken by `tool_use` id so the order is deterministic. */
function byRecencyDesc(a: ToolCallSample, b: ToolCallSample): number {
  const at = a.timestamp ?? "";
  const bt = b.timestamp ?? "";
  if (at !== bt) return bt.localeCompare(at);
  return (a.toolUseId ?? "").localeCompare(b.toolUseId ?? "");
}

/** Biggest first; ties broken by `tool_use` id so the order is deterministic. */
function bySizeDesc(a: ToolCallSample, b: ToolCallSample): number {
  const diff = (b.charSize ?? 0) - (a.charSize ?? 0);
  if (diff !== 0) return diff;
  return (a.toolUseId ?? "").localeCompare(b.toolUseId ?? "");
}

/**
 * The Skill/Agent breakdown: group the calls by the tool's own key field
 * (`input.skill` / `input.subagent_type`), calls descending then key ascending.
 * Any other tool gets no breakdown at all.
 */
function breakdownFor(name: string, rows: SampleRow[]): ToolBreakdownEntry[] {
  const field = BREAKDOWN_FIELD[name];
  if (field === undefined) return [];

  const byKey = new Map<string, ToolBreakdownEntry>();
  for (const row of rows) {
    const key = inputField(row.inputJson, field) ?? UNKNOWN_KEY;
    let entry = byKey.get(key);
    if (entry === undefined) {
      entry = { key, calls: 0, errors: 0 };
      byKey.set(key, entry);
    }
    entry.calls += 1;
    if (row.isError) entry.errors += 1;
  }

  return [...byKey.values()].sort((a, b) =>
    a.calls === b.calls ? a.key.localeCompare(b.key) : b.calls - a.calls,
  );
}

/** Read one string field out of a stored tool input; null when absent/unparseable. */
function inputField(inputJson: string, field: string): string | null {
  try {
    const parsed: unknown = JSON.parse(inputJson);
    if (parsed === null || typeof parsed !== "object") return null;
    const value = (parsed as Record<string, unknown>)[field];
    return typeof value === "string" && value !== "" ? value : null;
  } catch {
    return null;
  }
}
