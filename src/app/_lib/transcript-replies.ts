// A Transcript page read as Replies (GLOSSARY.md): the Turns between two
// Messages addressed to the Agent group under one speaker. Pure, like its
// `transcript` sibling — only type-only imports cross the ADR-0002 boundary —
// and the one grouping the Transcript view and the Conversation export share.

import type { ReplyFigures, TranscriptMessage, TranscriptView } from "@/core/read";

/** What a Reply's header says about the whole Reply, as core reads it — re-exported for the components. */
export type { ReplyFigures } from "@/core/read";

/** One Reply as a page shows it: the Turns the page holds, and the figures of the whole Reply. */
export type Reply = {
  /** Its Turns on this page, in Transcript order; never empty. */
  turns: TranscriptMessage[];
  /** The whole Reply's figures, even when part of it lies on another page. */
  figures: ReplyFigures;
  /** True when the Reply began on an earlier page. */
  continuesFromPreviousPage: boolean;
};

/** One entry of a page read as Replies: a Message addressed to the Agent, or a Reply. */
export type TranscriptEntry = { kind: "message"; message: TranscriptMessage } | { kind: "reply"; reply: Reply };

/**
 * A Transcript page's Messages as entries: each Message addressed to the
 * Agent alone, each run of Turns between two of them one Reply. A Reply the
 * page opens or ends inside takes the whole Reply's figures from the view's
 * `openingReply`/`closingReply`; any other is described by its own Turns.
 *
 * @example groupTurnsIntoReplies(view.messages, view).map((entry) => entry.kind) // ["message", "reply", "message"]
 */
export function groupTurnsIntoReplies(
  messages: TranscriptMessage[],
  splitReplies: Pick<TranscriptView, "openingReply" | "closingReply">,
): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  let turns: TranscriptMessage[] = [];
  const closeReply = (isPageEnd: boolean) => {
    if (turns.length === 0) return;
    const isPageStart = entries.length === 0;
    const continuesFromPreviousPage = isPageStart && splitReplies.openingReply !== null;
    const figures =
      (continuesFromPreviousPage ? splitReplies.openingReply : null) ??
      (isPageEnd ? splitReplies.closingReply : null) ??
      figuresOf(turns);
    entries.push({ kind: "reply", reply: { turns, figures, continuesFromPreviousPage } });
    turns = [];
  };
  for (const message of messages) {
    if (message.role === "assistant") {
      turns.push(message);
      continue;
    }
    closeReply(false);
    entries.push({ kind: "message", message });
  }
  closeReply(true);
  return entries;
}

/** A Reply's figures read off its Turns, all of which the page holds. */
function figuresOf(turns: TranscriptMessage[]): ReplyFigures {
  const dated = turns.flatMap((turn) => (turn.timestamp === null ? [] : [turn.timestamp]));
  return {
    turnCount: turns.length,
    toolCallCount: turns.reduce((total, turn) => total + turn.toolCalls.length, 0),
    startedAt: dated[0] ?? null,
    endedAt: dated.at(-1) ?? null,
    costUsd: turns.reduce((total, turn) => total + turn.costUsd, 0),
    unpriced: turns.some((turn) => turn.unpriced),
    copiedTurnCount: turns.filter((turn) => turn.isCopied).length,
  };
}
