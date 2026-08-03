// API-error read API (issue #47, ADR-0002): "which turns of this conversation
// did the API fail on, and where?" — one row per failed turn of ANY agent, with
// what the detail panel shows and what a Transcript deep link needs.
//
// Split out of `read.ts` (already the conversation/transcript seam) so the
// error surface owns its own module, exactly like `tool-stats.ts` and
// `search.ts`. Read-only, and free of any `next`/`react` import.
//
// The COUNT of failed turns is not here: it belongs to every list row, so it
// rides along the batched rollup in `listConversations` (`errorCount`). This
// module is the per-error DETAIL, read only when a row is expanded.

import { readClient } from "@/core/db";

/** One failed turn of a conversation, in the agent it happened in. */
export type ConversationApiError = {
  /**
   * The `?agent=` key of the agent whose turn failed — `externalAgentId ??
   * String(id)`, the SAME rule `getTranscript` keys its tree by, so the panel's
   * deep link resolves to a real agent (sub-agents included).
   */
  agentId: string;
  /** Raw `agent_type`: null/empty on the main thread (the app maps it to "main"). */
  agentType: string | null;
  /**
   * The failed message's log `uuid` — the in-transcript anchor (`?msg=`); null
   * when the record carried none, in which case the link degrades to the agent.
   */
  messageUuid: string | null;
  /** The failed turn's timestamp as an ISO string; `""` when the log had none. */
  timestamp: string;
  /** `apiErrorStatus` verbatim (`overloaded_error`, …); null when not recorded. */
  status: string | null;
  /**
   * First {@link EXCERPT_CHARS} characters of the failed turn's text — usually
   * the `API Error: …` line. `""` when the turn produced no text at all (a
   * common shape: the status is then the whole story).
   */
  excerpt: string;
};

/** How much of a failed turn's text the panel shows inline. */
const EXCERPT_CHARS = 160;

export type ConversationErrorsOptions = {
  /** Additional (non-seam) opt for isolated DBs in refresh + tests. */
  dbPath?: string;
};

/**
 * Every failed turn of one conversation, oldest first, across ALL of its agents
 * (ADR-0001: a sub-agent's failure is the conversation's failure). A turn the
 * log never timestamped sorts LAST — the database would put its NULL first,
 * ahead of failures whose moment we actually know. Ties (equal timestamps, or
 * two undated turns) fall back to insertion order (`id`), so the list is
 * deterministic.
 *
 * An unknown session id yields `[]`, like a conversation that never failed:
 * both mean "nothing to show" to the panel.
 */
export async function getConversationErrors(
  sessionId: string,
  opts: ConversationErrorsOptions = {},
): Promise<ConversationApiError[]> {
  const { prisma, owned } = readClient(opts.dbPath);
  try {
    const rows = await prisma.message.findMany({
      where: { isApiError: true, conversation: { sessionId } },
      orderBy: [{ id: "asc" }],
      select: {
        uuid: true,
        timestamp: true,
        text: true,
        apiErrorMessage: true,
        agent: { select: { id: true, externalAgentId: true, agentType: true } },
      },
    });
    return rows.map(toApiError).sort(byMomentThenOrder);
  } finally {
    // Only a caller-owned (non-default) client is disconnected; the shared
    // default singleton stays open for the next request.
    if (owned) await prisma.$disconnect();
  }
}

/**
 * Order two errors: by moment (oldest first), undated ones last, and equal
 * moments in the insertion order the query already returned (a stable sort).
 */
function byMomentThenOrder(
  a: ConversationApiError,
  b: ConversationApiError,
): number {
  if (a.timestamp === b.timestamp) return 0;
  if (a.timestamp === "") return 1;
  if (b.timestamp === "") return -1;
  // ISO8601 strings sort lexically in chronological order.
  return a.timestamp < b.timestamp ? -1 : 1;
}

/** One failed `message` row as read for the panel. */
type ErrorRow = {
  uuid: string | null;
  timestamp: bigint | number | null;
  text: string | null;
  apiErrorMessage: string | null;
  agent: { id: number; externalAgentId: string | null; agentType: string | null };
};

/** Shape one row into an error (agent key + ISO timestamp + text excerpt). */
function toApiError(row: ErrorRow): ConversationApiError {
  return {
    agentId: row.agent.externalAgentId ?? String(row.agent.id),
    agentType: row.agent.agentType,
    messageUuid: row.uuid,
    timestamp:
      row.timestamp == null
        ? ""
        : new Date(Number(row.timestamp)).toISOString(),
    status: row.apiErrorMessage,
    excerpt: (row.text ?? "").slice(0, EXCERPT_CHARS),
  };
}
