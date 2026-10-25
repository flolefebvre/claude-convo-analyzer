import { describe, expect, it } from "vitest";

import {
  TRANSCRIPT_FILTER_EVERYTHING,
  TRANSCRIPT_FILTER_MESSAGES_ONLY,
  type FilteredEntry,
  type TranscriptFilter,
  applyTranscriptFilter,
  hiddenTurnsLabel,
  transcriptFilterKey,
} from "@/app/_lib/transcript-filter";
import { groupTurnsIntoReplies } from "@/app/_lib/transcript-replies";
import type { TranscriptMessage } from "@/core/read";

import { message, prompt, toolCalls, turn } from "./helpers/transcript-messages";

const NO_SPLIT = { openingReply: null, closingReply: null };
const NO_DEEP_LINK = {};

/** `messages` grouped into Replies, then filtered by `filter`. */
function filtered(
  messages: TranscriptMessage[],
  filter: TranscriptFilter,
  deepLink: { anchoredCall?: string; anchoredMessage?: string } = NO_DEEP_LINK,
): FilteredEntry[] {
  return applyTranscriptFilter(groupTurnsIntoReplies(messages, NO_SPLIT), filter, deepLink);
}

/** The items of the only Reply among `entries`. */
function replyItems(entries: FilteredEntry[]) {
  const reply = entries.find((entry) => entry.kind === "reply");
  if (reply?.kind !== "reply") throw new Error("no Reply");
  return reply.items;
}

const TOOL_CALLS_OFF = { ...TRANSCRIPT_FILTER_EVERYTHING, toolCalls: false };

describe("applyTranscriptFilter", () => {
  it("folds nothing and changes nothing under Everything, whatever each entry holds", () => {
    const entries = filtered(
      [
        prompt(),
        turn({ text: "Looking.", thinkingText: "Plan.", thinkingDurationMs: 900, toolCalls: toolCalls(2) }),
        turn({ toolCalls: toolCalls(1), apiRequestId: 7 }),
        turn({ thinkingDurationMs: 300 }),
        turn({ isApiError: true, apiErrorMessage: "Overloaded" }),
        message({ kind: "inter-agent" }),
        message({ kind: "task-notification" }),
        turn(),
      ],
      TRANSCRIPT_FILTER_EVERYTHING,
    );

    for (const entry of entries) {
      if (entry.kind === "message") expect(entry.fold).toBeNull();
      else
        for (const item of entry.items) {
          expect(item.kind).toBe("turn");
          if (item.kind === "turn")
            expect([item.showsThinking, item.showsWhatWasSent, item.toolCallsFold]).toEqual([true, true, null]);
        }
    }
  });

  it("folds a Turn's hidden Tool calls into its own line when the Turn still has text", () => {
    const items = replyItems(filtered([prompt(), turn({ text: "Ran it.", toolCalls: toolCalls(3) })], TOOL_CALLS_OFF));

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "turn", toolCallsFold: { isRevealed: false } });
  });

  it("folds consecutive Turns left with nothing to show into one run, counting their Tool calls", () => {
    const emptied = [turn({ toolCalls: toolCalls(1) }), turn({ toolCalls: toolCalls(3) })];
    const items = replyItems(filtered([prompt(), ...emptied, turn({ text: "Found it." })], TOOL_CALLS_OFF));

    expect(items.map((item) => item.kind)).toEqual(["hidden-turns", "turn"]);
    expect(items[0]).toMatchObject({ toolCallCount: 4, isRevealed: false });
    if (items[0].kind === "hidden-turns") expect(items[0].turns.map((item) => item.turn)).toEqual(emptied);
  });

  it("keeps each hidden Turn's own number", () => {
    const emptied = turn({ toolCalls: toolCalls(1), turnNumber: 41 });
    const items = replyItems(filtered([prompt(), emptied], TOOL_CALLS_OFF));

    if (items[0].kind !== "hidden-turns") throw new Error("not folded");
    expect(items[0].turns[0].turn.turnNumber).toBe(41);
  });

  it("shows a hidden run's Tool calls and thinking once revealed, and What was sent only when the filter does", () => {
    const items = replyItems(
      filtered([prompt(), turn({ toolCalls: toolCalls(1), thinkingDurationMs: 200 })], TRANSCRIPT_FILTER_MESSAGES_ONLY),
    );

    if (items[0].kind !== "hidden-turns") throw new Error("not folded");
    expect(items[0].turns[0]).toMatchObject({ showsThinking: true, showsWhatWasSent: false, toolCallsFold: null });
  });

  it("leaves a Reply with nothing to show its header's figures and one fold line", () => {
    const entries = filtered(
      [prompt(), turn({ toolCalls: toolCalls(2) }), turn({ toolCalls: toolCalls(1) })],
      TOOL_CALLS_OFF,
    );
    const reply = entries[1];

    if (reply.kind !== "reply") throw new Error("no Reply");
    expect(reply.reply.figures).toMatchObject({ turnCount: 2, toolCallCount: 3 });
    expect(reply.items.map((item) => item.kind)).toEqual(["hidden-turns"]);
  });

  it("always shows a Turn's text, and a failed Turn's notice, hiding only its thinking", () => {
    const items = replyItems(
      filtered(
        [
          prompt(),
          turn({ text: "Answer.", thinkingDurationMs: 400 }),
          turn({ isApiError: true, thinkingDurationMs: 100 }),
        ],
        TRANSCRIPT_FILTER_MESSAGES_ONLY,
      ),
    );

    expect(items.map((item) => [item.kind, item.kind === "turn" && item.showsThinking])).toEqual([
      ["turn", false],
      ["turn", false],
    ]);
  });

  it("folds a Turn whose only hidden content is its thinking", () => {
    const items = replyItems(
      filtered([prompt(), turn({ thinkingDurationMs: 300 })], { ...TRANSCRIPT_FILTER_EVERYTHING, thinking: false }),
    );

    expect(items[0]).toMatchObject({ kind: "hidden-turns", toolCallCount: 0 });
  });

  it("keeps a Turn that had nothing to hide as it is", () => {
    const items = replyItems(filtered([prompt(), turn()], TRANSCRIPT_FILTER_MESSAGES_ONLY));

    expect(items[0]).toMatchObject({ kind: "turn", toolCallsFold: null });
  });

  it("keeps a Turn whose own What was sent still shows, folding its Tool calls inside it", () => {
    const items = replyItems(filtered([prompt(), turn({ apiRequestId: 3, toolCalls: toolCalls(1) })], TOOL_CALLS_OFF));

    expect(items[0]).toMatchObject({ kind: "turn", showsWhatWasSent: true, toolCallsFold: { isRevealed: false } });
  });

  it("does not keep a copied Turn for What was sent, which is its owner's", () => {
    const copied = turn({
      apiRequestId: 3,
      isCopied: true,
      copiedFrom: { sessionId: "s", title: null, agentId: null, messageUuid: null },
      toolCalls: toolCalls(1),
    });
    const items = replyItems(filtered([prompt(), copied], TOOL_CALLS_OFF));

    expect(items[0].kind).toBe("hidden-turns");
  });

  it("folds a hidden Inter-agent message and a hidden Task notification into a line each, and never a Prompt", () => {
    const entries = filtered([prompt(), message({ kind: "inter-agent" }), message({ kind: "task-notification" })], {
      ...TRANSCRIPT_FILTER_EVERYTHING,
      interAgentMessages: false,
      taskNotifications: false,
    });

    expect(entries.map((entry) => entry.kind === "message" && entry.fold)).toEqual([
      null,
      { isRevealed: false },
      { isRevealed: false },
    ]);
  });

  it("keeps Inter-agent messages under Messages only", () => {
    const entries = filtered([prompt(), message({ kind: "inter-agent" })], TRANSCRIPT_FILTER_MESSAGES_ONLY);

    expect(entries[1]).toMatchObject({ kind: "message", fold: null });
  });

  it("reveals the fold holding a `?call=` deep link's Tool call", () => {
    const items = replyItems(
      filtered(
        [prompt(), turn({ text: "Ran.", toolCalls: toolCalls(2, "a") }), turn({ toolCalls: toolCalls(1, "b") })],
        TOOL_CALLS_OFF,
        { anchoredCall: "b0" },
      ),
    );

    expect(items[0]).toMatchObject({ kind: "turn", toolCallsFold: { isRevealed: false } });
    expect(items[1]).toMatchObject({ kind: "hidden-turns", isRevealed: true });
  });

  it("reveals the fold holding a `?msg=` deep link's Turn or Message", () => {
    const anchoredTurn = turn({ toolCalls: toolCalls(1) });
    const notification = message({ kind: "task-notification" });
    const filter = { ...TOOL_CALLS_OFF, taskNotifications: false };

    expect(
      replyItems(filtered([prompt(), anchoredTurn], filter, { anchoredMessage: anchoredTurn.uuid! }))[0],
    ).toMatchObject({
      isRevealed: true,
    });
    expect(filtered([prompt(), notification], filter, { anchoredMessage: notification.uuid! })[1]).toMatchObject({
      fold: { isRevealed: true },
    });
  });
});

describe("hiddenTurnsLabel", () => {
  it("names the Turns and the Tool calls a run holds", () => {
    expect(hiddenTurnsLabel({ turnCount: 2, toolCallCount: 4 })).toBe("2 turns · 4 tool calls");
    expect(hiddenTurnsLabel({ turnCount: 1, toolCallCount: 1 })).toBe("1 turn · 1 tool call");
  });

  it("names only the Turns of a run with no Tool call", () => {
    expect(hiddenTurnsLabel({ turnCount: 2, toolCallCount: 0 })).toBe("2 turns");
  });
});

describe("transcriptFilterKey", () => {
  it("differs between two filters, and matches for the same one", () => {
    expect(transcriptFilterKey(TRANSCRIPT_FILTER_EVERYTHING)).not.toBe(transcriptFilterKey(TOOL_CALLS_OFF));
    expect(transcriptFilterKey({ ...TOOL_CALLS_OFF })).toBe(transcriptFilterKey(TOOL_CALLS_OFF));
  });
});
