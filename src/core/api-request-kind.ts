// The kind of an API request (GLOSSARY.md, API request, Side request): what the
// Refresh stores on each `api_request` row, told deterministically from what
// the request sent (ADR-0002: the database is a cache of the sources, never a
// read-time guess). Framework-free.

import type { SentOutline } from "@/core/recording";

/** The kind of a Side request (GLOSSARY.md, Side request). */
export type SideRequestKind =
  "session-naming" | "quota-probe" | "safety-monitor" | "suggestion" | "token-count" | "other";

/** The kind of an API request: a Turn's request, a failed attempt of one, or a Side request's kind. */
export type ApiRequestKind = "turn" | "failed-attempt" | SideRequestKind;

/** Every Side request kind, in the order the views list them. */
export const SIDE_REQUEST_KINDS: readonly SideRequestKind[] = [
  "session-naming",
  "quota-probe",
  "safety-monitor",
  "suggestion",
  "token-count",
  "other",
];

/** What the classifier knows of one API request. */
export type ClassifiedApiRequest = {
  /** True when it joined a Turn by its `requestId` or `message.id`. */
  isJoinedToTurn: boolean;
  /** True when it is a failed attempt a later retry of the same Agent and body joined to a Turn. */
  isRetriedByTurn: boolean;
  /** True when it did not succeed (a status outside 2xx, an error, a proxy error, Claude Code disconnecting). */
  isFailed: boolean;
  path: string;
  sentOutline: SentOutline;
};

/** The first line of the system block Claude Code adds for billing; never part of what a request is. */
const BILLING_HEADER_PREFIX = "x-anthropic-billing-header:";

/** The openings of Claude Code's own system prompt, the CLI's and the Agent SDK's. */
const CLAUDE_CODE_SYSTEM_OPENINGS = [
  "You are Claude Code, Anthropic's official CLI for Claude.",
  "You are Claude Code, Anthropic's official CLI for Claude, running within the Claude Agent SDK.",
  "You are a Claude agent, built on Anthropic's Claude Agent SDK.",
];

const TOKEN_COUNT_PATH_SUFFIX = "/count_tokens";
const QUOTA_PROBE_TEXT = "quota";
const SUGGESTION_PREFIX = "[SUGGESTION MODE";
const SAFETY_MONITOR_OPENING = "You are a security monitor for autonomous AI coding agents";
const SESSION_NAMING_OPENING = "You are naming a coding session";

/**
 * The kind of one API request, and for `other` its label: the first line of
 * its system prompt (null without one). First match wins:
 *
 * 1. joined to a Turn → `turn`;
 * 2. a failed attempt a retry joined to a Turn → `failed-attempt`;
 * 3. its path ends with `/count_tokens` → `token-count`;
 * 4. it sent one message, whose text is `quota` → `quota-probe`;
 * 5. a text block of its last user message starts with `[SUGGESTION MODE` → `suggestion`
 *    (a suggestion otherwise sends the Main thread's own request);
 * 6. a system block opens with `You are a security monitor for autonomous AI coding agents`
 *    → `safety-monitor`;
 * 7. a system block opens with `You are naming a coding session` → `session-naming`;
 * 8. it did not succeed, sent messages, and its system prompt opens as Claude
 *    Code's own — `You are Claude Code, Anthropic's official CLI for Claude.`,
 *    `You are Claude Code, Anthropic's official CLI for Claude, running within the Claude Agent SDK.`
 *    or `You are a Claude agent, built on Anthropic's Claude Agent SDK.` →
 *    `failed-attempt`: a Turn's request Claude Code gave up retrying;
 * 9. anything else → `other`.
 *
 * A system block opening with `x-anthropic-billing-header:` is skipped
 * wherever the system prompt is read. A Side request that did not succeed
 * keeps its kind (a quota probe is usually answered 429).
 *
 * These signals were read from the Claude Code binary, version 2.1.303, as no
 * captured traffic was available: the quota check sends
 * `messages: [{ role: "user", content: "quota" }]` with `max_tokens: 1`; the
 * prompt suggestion appends a user text opening
 * `[SUGGESTION MODE: Suggest what the user might naturally type next into Claude Code.]`;
 * the auto-mode reviewer's system prompt opens
 * `You are a security monitor for autonomous AI coding agents.`; the session
 * title's opens
 * `You are naming a coding session so the user can pick it out of a long list of sessions.`;
 * the billing block reads `x-anthropic-billing-header: cc_version=…; cc_entrypoint=…;`.
 * Compare a mis-classified request against these first.
 *
 * @example
 * const { kind, otherKindLabel } = classifyApiRequest({ isJoinedToTurn: false, isRetriedByTurn: false, isFailed: false, path, sentOutline });
 */
export function classifyApiRequest(apiRequest: ClassifiedApiRequest): {
  kind: ApiRequestKind;
  otherKindLabel: string | null;
} {
  const systemOpenings = systemOpeningsOf(apiRequest.sentOutline);
  const kind = kindOf(apiRequest, systemOpenings);
  return { kind, otherKindLabel: kind === "other" ? (systemOpenings[0] ?? null) : null };
}

/** The kind of `apiRequest`, whose system prompt opens with `systemOpenings` (rules above). */
function kindOf(apiRequest: ClassifiedApiRequest, systemOpenings: string[]): ApiRequestKind {
  const { sentOutline } = apiRequest;
  if (apiRequest.isJoinedToTurn) return "turn";
  if (apiRequest.isRetriedByTurn) return "failed-attempt";
  if (apiRequest.path.endsWith(TOKEN_COUNT_PATH_SUFFIX)) return "token-count";
  if (sentOutline.messageCount === 1 && sentOutline.lastUserMessageFirstLines.join("\n").trim() === QUOTA_PROBE_TEXT) {
    return "quota-probe";
  }
  if (sentOutline.lastUserMessageFirstLines.some((line) => line.trimStart().startsWith(SUGGESTION_PREFIX))) {
    return "suggestion";
  }
  if (systemOpenings.some((line) => line.startsWith(SAFETY_MONITOR_OPENING))) return "safety-monitor";
  if (systemOpenings.some((line) => line.startsWith(SESSION_NAMING_OPENING))) return "session-naming";
  const isClaudeCodeSystemPrompt = systemOpenings.length > 0 && CLAUDE_CODE_SYSTEM_OPENINGS.includes(systemOpenings[0]);
  if (apiRequest.isFailed && isClaudeCodeSystemPrompt && sentOutline.messageCount > 0) return "failed-attempt";
  return "other";
}

/** The first lines of the system blocks that say what the request is: the billing block left out. */
function systemOpeningsOf(sentOutline: SentOutline): string[] {
  return sentOutline.systemFirstLines.filter((line) => !line.startsWith(BILLING_HEADER_PREFIX));
}

/**
 * True when `kind` is a Side request's.
 *
 * @example isSideRequestKind("quota-probe") // true
 */
export function isSideRequestKind(kind: string): kind is SideRequestKind {
  return (SIDE_REQUEST_KINDS as readonly string[]).includes(kind);
}
