// Pure app-zone aggregate for the overview band (the analysis surface): the
// headline cost/token/count stats and the cost-ranked Projects shown above the
// conversation table. Built ON TOP of the core's `ConversationSummary[]` and the
// already-derived `FolderEntry[]` — no new core API (ADR-0002). The only core
// touch is a type-only import of `Tokens`, erased at compile time.
//
// React-free + I/O-free so it unit-tests in the node vitest environment, exactly
// like `folders.ts` and `format.ts` (the cost logic is on the deterministic
// critical path, so it is covered test-first).

import type { Tokens } from "@/core/cost";
import type { ConversationSummary } from "@/core/refresh";

import type { FolderEntry } from "@/app/_lib/folders";

/** The headline analysis of a set of conversations, for the overview band. */
export type Overview = {
  /** Number of conversations summarized. */
  conversationCount: number;
  /** Number of distinct Projects the conversations belong to. */
  projectCount: number;
  /** Summed cost (USD); a lower bound when {@link hasUnpriced} is true. */
  totalCost: number;
  /** True when ANY conversation has unpriced usage (cost is a lower bound). */
  hasUnpriced: boolean;
  /** Summed tokens by bucket across all conversations. */
  tokens: Tokens;
  /** Share of total tokens served from cache reads, in `[0, 1]`. `0` when there
   *  are no tokens (no divide-by-zero). */
  cacheReadRatio: number;
  /** Earliest known `startedAt` across all rows, as an ISO string; `""` if none. */
  earliest: string;
  /** Latest activity (`endedAt`, falling back to `startedAt`); `""` if none. */
  latest: string;
};

/**
 * Aggregate the headline analysis of `summaries`: counts, summed cost + tokens,
 * cache-read share, and the activity date range. Pure — no mutation of inputs.
 * Empty input yields zeroed totals and an empty (`""`) date range.
 */
export function deriveOverview(summaries: ConversationSummary[]): Overview {
  const tokens: Tokens = {
    input: 0,
    output: 0,
    cacheWrite: 0,
    cacheRead: 0,
    total: 0,
  };
  const projects = new Set<string>();
  let totalCost = 0;
  let hasUnpriced = false;
  let earliest = "";
  let latest = "";

  for (const s of summaries) {
    projects.add(s.project.folder);
    tokens.input += s.tokens.input;
    tokens.output += s.tokens.output;
    tokens.cacheWrite += s.tokens.cacheWrite;
    tokens.cacheRead += s.tokens.cacheRead;
    tokens.total += s.tokens.total;
    totalCost += s.costUsd;
    if (s.unpriced) hasUnpriced = true;

    // ISO8601 strings sort lexically in chronological order, so plain string
    // comparison gives the min/max moment. "" (the core's "unknown" sentinel)
    // is skipped on both ends.
    if (s.startedAt !== "" && (earliest === "" || s.startedAt < earliest)) {
      earliest = s.startedAt;
    }
    const activity = s.endedAt !== "" ? s.endedAt : s.startedAt;
    if (activity !== "" && activity > latest) latest = activity;
  }

  return {
    conversationCount: summaries.length,
    projectCount: projects.size,
    totalCost,
    hasUnpriced,
    tokens,
    cacheReadRatio: tokens.total === 0 ? 0 : tokens.cacheRead / tokens.total,
    earliest,
    latest,
  };
}

/**
 * The `limit` highest-cost Projects, cost descending. Returns a new array — the
 * input order is preserved (the sidebar keeps its own newest-first ordering).
 */
export function topProjectsByCost(
  entries: FolderEntry[],
  limit: number,
): FolderEntry[] {
  return [...entries].sort((a, b) => b.costUsd - a.costUsd).slice(0, limit);
}
