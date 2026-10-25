// Shared test setup: the rendered Messages the Transcript's pure helpers read
// (`transcript-replies`, `transcript-filter`). Each test states only the fields
// it asserts on; every other field is inert.
//
// Not a test file: it declares no tests and lives under `__tests__/helpers/`,
// which vitest's `include` excludes (see `vitest.config.ts`).

import type { TranscriptMessage, TranscriptToolCall } from "@/core/read";

let nextId = 1;

/**
 * A rendered Message: a Turn unless `kind` names a Message addressed to the Agent; every other field neutral.
 *
 * @example message({ kind: "inter-agent" })
 */
export function message(partial: Partial<TranscriptMessage> = {}): TranscriptMessage {
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

/**
 * A Prompt.
 *
 * @example prompt({ text: "Fix the test." })
 */
export const prompt = (partial: Partial<TranscriptMessage> = {}) => message({ kind: "prompt", ...partial });

/**
 * A Turn.
 *
 * @example turn({ text: "Done.", toolCalls: toolCalls(2) })
 */
export const turn = (partial: Partial<TranscriptMessage> = {}) => message(partial);

/**
 * `count` Bash Tool calls, their `tool_use` ids `<prefix>0`, `<prefix>1`, ….
 *
 * @example toolCalls(2, "a") // toolUseIds "a0", "a1"
 */
export function toolCalls(count: number, toolUseIdPrefix = "tu"): TranscriptToolCall[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    toolUseId: `${toolUseIdPrefix}${i}`,
    name: "Bash",
    inputJson: "{}",
    resultTruncated: false,
    resultCharSize: null,
    isError: false,
  }));
}
