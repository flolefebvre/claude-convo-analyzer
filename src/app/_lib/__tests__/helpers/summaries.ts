import type { Tokens } from "@/core/cost";
import type { ConversationSummary } from "@/core/read";

export function summary(over: {
  id: string;
  folder?: string;
  path?: string;
  startedAt?: string;
  endedAt?: string;
  tokens?: Partial<Tokens>;
  costUsd?: number;
  unpriced?: boolean;
  errorCount?: number;
}): ConversationSummary {
  const path = over.path ?? "/Users/me/dev/demo";
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
