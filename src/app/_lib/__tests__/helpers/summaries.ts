// Shared test setup: the minimal `ConversationSummary` the app-zone view tests
// build their rows from. Every such test needs the same inert 14-field record
// and states only the field(s) it asserts on, so the factory lives here once.
//
// Not a test file: it declares no tests and lives under `__tests__/helpers/`,
// which vitest's `include` excludes (see `vitest.config.ts`).

import type { Tokens } from "@/core/cost";
import type { ConversationSummary } from "@/core/read";

/**
 * A `ConversationSummary` with every unstated field defaulted to an inert value.
 *
 * @example summary({ id: "a", folder: "fA", path: "/p/alpha", costUsd: 5 })
 */
export function summary(over: {
  id: string;
  /** Folder key; defaults to the dash-encoded `path`, the way the core derives it. */
  folder?: string;
  path?: string;
  startedAt?: string;
  endedAt?: string;
  /** Token buckets to override; the rest stay 0. */
  tokens?: Partial<Tokens>;
  costUsd?: number;
  unpriced?: boolean;
  errorCount?: number;
}): ConversationSummary {
  const path = over.path ?? "/Users/me/dev/demo";
  // Dash-encode the path the way the core does, unless an explicit folder key is
  // supplied (so a test can force a folder identity independent of its path).
  const folder = over.folder ?? path.replace(/\//g, "-");
  return {
    id: over.id,
    title: `t-${over.id}`,
    project: { folder, path },
    startedAt: over.startedAt ?? "2026-01-01T00:00:00.000Z",
    endedAt: over.endedAt ?? "2026-01-01T01:00:00.000Z",
    models: { dominant: "opus", distinctCount: 1 },
    tokens: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: 0, ...over.tokens },
    costUsd: over.costUsd ?? 0,
    costByType: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
    unpriced: over.unpriced ?? false,
    subAgentCount: 0,
    errorCount: over.errorCount ?? 0,
    continuedFromId: null,
  };
}
