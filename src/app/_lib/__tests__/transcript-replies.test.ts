import { describe, expect, it } from "vitest";

import { groupTurnsIntoReplies } from "@/app/_lib/transcript-replies";
import type { ReplyFigures, TranscriptMessage, TranscriptToolCall } from "@/core/read";

let nextId = 1;

/** A rendered Message: a Turn unless `kind` names a Message addressed to the Agent; every other field neutral. */
function message(partial: Partial<TranscriptMessage> = {}): TranscriptMessage {
  const id = nextId++;
  const isTurn = (partial.kind ?? null) === null;
  return {
    id,
    uuid: `u${id}`,
    role: isTurn ? "assistant" : "user",
    kind: null,
    text: null,
    origin: null,
    model: null,
    effort: null,
    thinkingText: null,
    thinkingDurationMs: null,
    tokens: null,
    costUsd: 0,
    unpriced: false,
    isApiError: false,
    apiErrorMessage: null,
    isCopied: false,
    copiedFrom: null,
    timestamp: null,
    turnNumber: isTurn ? id : null,
    toolCalls: [],
    apiRequestId: null,
    failedAttemptCount: 0,
    failedAttemptsLostMs: null,
    ...partial,
  };
}

const prompt = (partial: Partial<TranscriptMessage> = {}) => message({ kind: "prompt", ...partial });
const turn = (partial: Partial<TranscriptMessage> = {}) => message(partial);

/** `count` Tool calls, enough for the figures to count them. */
function toolCalls(count: number): TranscriptToolCall[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    toolUseId: `tu${i}`,
    name: "Bash",
    inputJson: "{}",
    resultTruncated: false,
    resultCharSize: null,
    isError: false,
  }));
}

const NO_SPLIT = { openingReply: null, closingReply: null };

/** A split Reply's whole figures, as core reads them. */
function wholeReply(partial: Partial<ReplyFigures> = {}): ReplyFigures {
  return {
    turnCount: 9,
    toolCallCount: 12,
    startedAt: "2026-06-22T09:00:00.000Z",
    endedAt: "2026-06-22T09:30:00.000Z",
    costUsd: 4.2,
    unpriced: false,
    copiedTurnCount: 0,
    ...partial,
  };
}

describe("groupTurnsIntoReplies", () => {
  it("groups the Turns between two Messages addressed to the Agent into one Reply, its figures read off them", () => {
    const first = prompt();
    const turns = [
      turn({ timestamp: "2026-06-22T09:00:05.000Z", costUsd: 0.25, toolCalls: toolCalls(2) }),
      turn({ timestamp: "2026-06-22T09:00:40.000Z", costUsd: 0.5, toolCalls: toolCalls(1) }),
    ];
    const notification = message({ kind: "task-notification" });
    const entries = groupTurnsIntoReplies([first, ...turns, notification], NO_SPLIT);

    expect(entries.map((entry) => entry.kind)).toEqual(["message", "reply", "message"]);
    const reply = entries[1];
    expect(reply.kind === "reply" && reply.reply).toEqual({
      turns,
      figures: {
        turnCount: 2,
        toolCallCount: 3,
        startedAt: "2026-06-22T09:00:05.000Z",
        endedAt: "2026-06-22T09:00:40.000Z",
        costUsd: 0.75,
        unpriced: false,
        copiedTurnCount: 0,
      },
      continuesFromPreviousPage: false,
    });
  });

  it("renders no Reply between two Messages addressed to the Agent with no Turn between them", () => {
    const entries = groupTurnsIntoReplies(
      [
        prompt(),
        prompt({ origin: { midTurn: true, senderAgentId: null, taskAgentId: null } }),
        message({ kind: "inter-agent" }),
      ],
      NO_SPLIT,
    );
    expect(entries.map((entry) => entry.kind)).toEqual(["message", "message", "message"]);
  });

  it("bounds a Reply's time range by its dated Turns, and leaves it empty when none is dated", () => {
    const dated = groupTurnsIntoReplies(
      [
        turn(),
        turn({ timestamp: "2026-06-22T09:00:05.000Z" }),
        turn(),
        turn({ timestamp: "2026-06-22T09:01:00.000Z" }),
      ],
      NO_SPLIT,
    );
    expect(dated[0].kind === "reply" && dated[0].reply.figures).toMatchObject({
      startedAt: "2026-06-22T09:00:05.000Z",
      endedAt: "2026-06-22T09:01:00.000Z",
    });

    const undated = groupTurnsIntoReplies([prompt(), turn(), turn()], NO_SPLIT);
    expect(undated[1].kind === "reply" && undated[1].reply.figures).toMatchObject({ startedAt: null, endedAt: null });
  });

  it("counts a Reply's copied Turns, and an unpriced Turn makes its cost a lower bound", () => {
    const entries = groupTurnsIntoReplies(
      [turn({ isCopied: true }), turn({ unpriced: true }), turn({ costUsd: 1 })],
      NO_SPLIT,
    );
    expect(entries[0].kind === "reply" && entries[0].reply.figures).toMatchObject({
      turnCount: 3,
      copiedTurnCount: 1,
      unpriced: true,
      costUsd: 1,
    });
  });

  it("gives a Reply begun on an earlier page the whole Reply's figures, continuing from the previous page", () => {
    const openingReply = wholeReply();
    const entries = groupTurnsIntoReplies([turn(), turn(), prompt(), turn()], { openingReply, closingReply: null });
    expect(entries[0].kind === "reply" && entries[0].reply).toMatchObject({
      figures: openingReply,
      continuesFromPreviousPage: true,
    });
    expect(entries[2].kind === "reply" && entries[2].reply).toMatchObject({
      figures: { turnCount: 1 },
      continuesFromPreviousPage: false,
    });
  });

  it("gives a Reply continued on a later page the whole Reply's figures", () => {
    const closingReply = wholeReply({ turnCount: 4 });
    const entries = groupTurnsIntoReplies([turn(), prompt(), turn(), turn()], { openingReply: null, closingReply });
    expect(entries[0].kind === "reply" && entries[0].reply.figures.turnCount).toBe(1);
    expect(entries[2].kind === "reply" && entries[2].reply).toMatchObject({
      figures: closingReply,
      continuesFromPreviousPage: false,
    });
  });

  it("renders a page lying wholly inside one Reply as that one Reply, continuing from the previous page", () => {
    const figures = wholeReply();
    const turns = [turn(), turn(), turn()];
    const entries = groupTurnsIntoReplies(turns, { openingReply: figures, closingReply: figures });
    expect(entries).toEqual([{ kind: "reply", reply: { turns, figures, continuesFromPreviousPage: true } }]);
  });
});
