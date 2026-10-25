// A Transcript page under the Transcript filter (GLOSSARY.md): which content
// shows, and which folds into a line that reveals it in place. Pure, like its
// `transcript-replies` sibling, whose entries it reads — only type-only imports
// cross the ADR-0002 boundary — and shared by the Transcript view and the
// Conversation export, which renders it under Everything.

import type { TranscriptMessage } from "@/core/read";
import type { TranscriptFilter } from "@/core/settings";

import type { Reply, TranscriptEntry } from "./transcript-replies";

/** The reader's Transcript filter, as core reads it — re-exported for the components. */
export type { TranscriptFilter } from "@/core/settings";

/**
 * The Transcript filter that shows every kind of content — the export's, and
 * the Show section's "Everything".
 *
 * @example applyTranscriptFilter(entries, TRANSCRIPT_FILTER_EVERYTHING, {})
 */
export const TRANSCRIPT_FILTER_EVERYTHING: TranscriptFilter = {
  toolCalls: true,
  thinking: true,
  whatWasSent: true,
  interAgentMessages: true,
  taskNotifications: true,
};

/**
 * The Show section's "Messages only": every kind off but Inter-agent messages, which are speech.
 *
 * @example isSameTranscriptFilter(filter, TRANSCRIPT_FILTER_MESSAGES_ONLY)
 */
export const TRANSCRIPT_FILTER_MESSAGES_ONLY: TranscriptFilter = {
  toolCalls: false,
  thinking: false,
  whatWasSent: false,
  interAgentMessages: true,
  taskNotifications: false,
};

/** The kinds of content the Transcript filter switches, in the Show section's order. */
export const TRANSCRIPT_FILTER_KINDS = [
  "toolCalls",
  "thinking",
  "whatWasSent",
  "interAgentMessages",
  "taskNotifications",
] as const satisfies readonly (keyof TranscriptFilter)[];

/**
 * A string naming `filter`, the same for the same choice: what the fold lines
 * are keyed on, so that changing the filter clears every reveal.
 *
 * @example transcriptFilterKey(TRANSCRIPT_FILTER_EVERYTHING) // "11111"
 */
export function transcriptFilterKey(filter: TranscriptFilter): string {
  return TRANSCRIPT_FILTER_KINDS.map((kind) => (filter[kind] ? "1" : "0")).join("");
}

/**
 * Whether `filter` and `other` show the same kinds of content.
 *
 * @example isSameTranscriptFilter(filter, TRANSCRIPT_FILTER_EVERYTHING) // true when nothing is hidden
 */
export function isSameTranscriptFilter(filter: TranscriptFilter, other: TranscriptFilter): boolean {
  return transcriptFilterKey(filter) === transcriptFilterKey(other);
}

/** A line standing in for hidden content: whether it renders already revealed, holding a deep link's target. */
export type Fold = { isRevealed: boolean };

/** One Turn as the filter leaves it. */
export type FilteredTurn = {
  kind: "turn";
  turn: TranscriptMessage;
  /** Whether its thinking line shows. */
  showsThinking: boolean;
  /** Whether its marker line offers What was sent, when it owns an API request. */
  showsWhatWasSent: boolean;
  /** The line standing in for its hidden Tool calls; null when they show, or it has none. */
  toolCallsFold: Fold | null;
};

/** Consecutive Turns of a Reply left with nothing to show, folded into one line; each shows its Tool calls and thinking once revealed. */
export type HiddenTurnRun = {
  kind: "hidden-turns";
  turns: FilteredTurn[];
  toolCallCount: number;
} & Fold;

/** One entry of a page under the filter: a Message addressed to the Agent, folded or not, or a Reply. */
export type FilteredEntry =
  | {
      kind: "message";
      message: TranscriptMessage;
      /** The line standing in for it when the filter hides its kind; null when it shows. */
      fold: Fold | null;
    }
  | { kind: "reply"; reply: Reply; items: (FilteredTurn | HiddenTurnRun)[] };

/** The `?call=` or `?msg=` target the page was opened on: the fold holding it renders revealed. */
export type DeepLinkTarget = { anchoredCall?: string; anchoredMessage?: string };

/**
 * A page's entries (`groupTurnsIntoReplies`) under `filter`. A Prompt, a
 * Turn's text and a failed Turn's notice always show; a Turn with text whose
 * Tool calls are hidden keeps a fold line for them; consecutive Turns left
 * with nothing to show fold into one line; a hidden Inter-agent message or
 * Task notification leaves its own line. Under Everything, nothing folds.
 *
 * @example applyTranscriptFilter(groupTurnsIntoReplies(view.messages, view), filter, { anchoredCall })
 */
export function applyTranscriptFilter(
  entries: TranscriptEntry[],
  filter: TranscriptFilter,
  deepLink: DeepLinkTarget,
): FilteredEntry[] {
  return entries.map((entry) => {
    if (entry.kind === "message") {
      const { message } = entry;
      const isHidden =
        (message.kind === "inter-agent" && !filter.interAgentMessages) ||
        (message.kind === "task-notification" && !filter.taskNotifications);
      return {
        kind: "message",
        message,
        fold: isHidden ? { isRevealed: isDeepLinkTarget(message, deepLink) } : null,
      };
    }
    return { kind: "reply", reply: entry.reply, items: filterReplyTurns(entry.reply.turns, filter, deepLink) };
  });
}

/** A Reply's Turns under `filter`: each one shown, or folded with its emptied neighbours. */
function filterReplyTurns(
  turns: TranscriptMessage[],
  filter: TranscriptFilter,
  deepLink: DeepLinkTarget,
): (FilteredTurn | HiddenTurnRun)[] {
  const items: (FilteredTurn | HiddenTurnRun)[] = [];
  let run: TranscriptMessage[] = [];
  const closeRun = () => {
    if (run.length === 0) return;
    items.push({
      kind: "hidden-turns",
      turns: run.map((turn) => ({
        kind: "turn",
        turn,
        showsThinking: true,
        showsWhatWasSent: filter.whatWasSent,
        toolCallsFold: null,
      })),
      toolCallCount: run.reduce((total, turn) => total + turn.toolCalls.length, 0),
      isRevealed: run.some((turn) => isDeepLinkTarget(turn, deepLink)),
    });
    run = [];
  };
  for (const turn of turns) {
    if (isEmptiedBy(turn, filter)) {
      run.push(turn);
      continue;
    }
    closeRun();
    const hidesToolCalls = turn.toolCalls.length > 0 && !filter.toolCalls;
    items.push({
      kind: "turn",
      turn,
      showsThinking: filter.thinking,
      showsWhatWasSent: filter.whatWasSent,
      toolCallsFold: hidesToolCalls ? { isRevealed: isDeepLinkTarget(turn, deepLink) } : null,
    });
  }
  closeRun();
  return items;
}

/**
 * True when `filter` leaves `turn` with nothing to show: no text, no failed
 * Turn's notice, something hidden — its Tool calls or its thinking — and
 * nothing it hides by kind still showing, What was sent included.
 */
function isEmptiedBy(turn: TranscriptMessage, filter: TranscriptFilter): boolean {
  if ((turn.text ?? "").trim() !== "" || turn.isApiError) return false;
  const hasToolCalls = turn.toolCalls.length > 0;
  const hasThinking = turn.thinkingText !== null || turn.thinkingDurationMs !== null;
  const ownsWhatWasSent = turn.copiedFrom === null && turn.apiRequestId !== null;
  const hidesSomething = (hasToolCalls && !filter.toolCalls) || (hasThinking && !filter.thinking);
  const showsSomething =
    (hasToolCalls && filter.toolCalls) || (hasThinking && filter.thinking) || (ownsWhatWasSent && filter.whatWasSent);
  return hidesSomething && !showsSomething;
}

/** True when the page's deep link names `message`, or, on a Turn, one of its Tool calls. */
function isDeepLinkTarget(message: TranscriptMessage, deepLink: DeepLinkTarget): boolean {
  if (deepLink.anchoredMessage !== undefined && message.uuid === deepLink.anchoredMessage) return true;
  return (
    deepLink.anchoredCall !== undefined && message.toolCalls.some((call) => call.toolUseId === deepLink.anchoredCall)
  );
}

/**
 * What a run of hidden Turns holds, as its fold line names it: the Turns,
 * then their Tool calls when there are any.
 *
 * @example hiddenTurnsLabel({ turnCount: 2, toolCallCount: 4 }) // "2 turns · 4 tool calls"
 */
export function hiddenTurnsLabel({ turnCount, toolCallCount }: { turnCount: number; toolCallCount: number }): string {
  const turns = `${turnCount} turn${turnCount === 1 ? "" : "s"}`;
  return toolCallCount === 0 ? turns : `${turns} · ${toolCallCountLabel(toolCallCount)}`;
}

/**
 * A count of Tool calls, as a fold line names it.
 *
 * @example toolCallCountLabel(3) // "3 tool calls"
 */
export function toolCallCountLabel(toolCallCount: number): string {
  return `${toolCallCount} tool call${toolCallCount === 1 ? "" : "s"}`;
}
