// Pure presentation helpers for the transcript pane (the `/conversation/<id>`
// two-pane view). Like its `format`/`sort`/`detail` siblings this module is free
// of React, I/O, and any runtime dependency on `src/core` — only type-only
// imports (erased at compile time) cross the ADR-0002 boundary. The shaping and
// classification logic lives here so it is unit-tested in the node vitest
// environment; the route/components are thin renderers over these.

import type { TranscriptAgentNode } from "@/core/read";

/** A Tool call's body, as core reads it — re-exported so a client leaf can name it without touching core. */
export type { ToolCallBody } from "@/core/read";

/** What a recorded Turn sent, as core reads it — re-exported for the client leaf, like {@link ToolCallBody}. */
export type { DiffLine, SentBlock, SentMessage, SentTool, WhatWasSent } from "@/core/what-was-sent";

import { subAgentLabel } from "@/app/_lib/detail";
import { formatTokens } from "@/app/_lib/format";

/**
 * App-side mirror of core's `RESULT_TRUNCATE_CHARS` (`src/core/refresh.ts`): the
 * stored-length cap the refresh applies to a tool result before persisting it.
 * Re-declared here (NOT imported) so this pure app helper never pulls core
 * runtime across the ADR-0002 boundary. Keep in sync with core.
 */
export const RESULT_TRUNCATE_CHARS = 10_000;

/** How long a single-line call snippet may get before it is ellipsised. */
const SNIPPET_MAX = 140;

/** The three visual kinds of tool call the transcript renders. */
export type TranscriptCallKind = "agent" | "skill" | "tool";

/**
 * Classify a tool call for its badge/colour. The sub-agent spawn tool is named
 * `Agent` (see `extractAgentSpawn` / `extractToolUseBlocks` in `src/core/parse`),
 * the skill loader is `Skill`; everything else renders as a plain `tool`.
 */
export function classifyToolCall(call: { name: string }): TranscriptCallKind {
  if (call.name === "Agent") return "agent";
  if (call.name === "Skill") return "skill";
  return "tool";
}

/** Parse a stored `inputJson` to a plain object, or `null` if it isn't one. */
function parseInput(inputJson: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(inputJson) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** The first string-valued field of an input object, or "" if there is none. */
function firstStringField(input: Record<string, unknown>): string {
  for (const value of Object.values(input)) {
    if (typeof value === "string" && value !== "") return value;
  }
  return "";
}

/** Collapse whitespace/newlines to single spaces and ellipsise if too long. */
function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > SNIPPET_MAX ? `${flat.slice(0, SNIPPET_MAX - 1)}…` : flat;
}

/**
 * A short, single-line summary of a tool call's input for the collapsed call
 * row. The key field depends on the kind: Bash → `command`, Skill → `skill`
 * (+ `args`), Agent → `subagent_type: prompt`; anything else falls back to the
 * first string field. NEVER throws on malformed/empty JSON — returns "".
 */
export function toolCallSnippet(call: { name: string; inputJson: string }): string {
  const input = parseInput(call.inputJson);
  if (input === null) return "";

  const str = (key: string): string => (typeof input[key] === "string" ? (input[key] as string) : "");

  const kind = classifyToolCall(call);
  if (kind === "agent") {
    const type = str("subagent_type");
    const prompt = str("prompt") || str("description");
    const combined = type && prompt ? `${type}: ${prompt}` : type || prompt;
    return oneLine(combined);
  }
  if (kind === "skill") {
    const skill = str("skill");
    const args = str("args");
    return oneLine(args ? `${skill} ${args}` : skill);
  }
  if (call.name === "Bash") return oneLine(str("command"));
  return oneLine(firstStringField(input));
}

/**
 * The truncation marker for a tool result, or `null` when nothing was cut. The
 * refresh stores at most {@link RESULT_TRUNCATE_CHARS}; when the full result was
 * longer we surface the original size and the stored cap (thousands-separated
 * via {@link formatTokens}). `resultCharSize` may be unknown (`null`) — then only
 * the stored cap is shown.
 */
export function truncationNote(call: { resultTruncated: boolean; resultCharSize: number | null }): string | null {
  if (!call.resultTruncated) return null;
  const stored = `stored first ${formatTokens(RESULT_TRUNCATE_CHARS)}`;
  return call.resultCharSize === null ? stored : `${formatTokens(call.resultCharSize)} chars total — ${stored}`;
}

/** A user prompt split into its optional slash-command parts, if any. */
export type ParsedPrompt = {
  isSlashCommand: boolean;
  commandName: string | null;
  commandArgs: string | null;
  /** The free text with the command tags stripped (whole text when not a slash). */
  rest: string;
};

const NON_SLASH = (rest: string): ParsedPrompt => ({
  isSlashCommand: false,
  commandName: null,
  commandArgs: null,
  rest,
});

/** Inner text of the first `<tag>…</tag>` pair, trimmed, or `null` if unclosed/absent. */
function tagContent(text: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text);
  return match ? match[1].trim() : null;
}

/**
 * Split a user prompt into slash-command parts. Claude stores an invoked command
 * as `<command-name>…</command-name>` (+ optional `<command-message>` and
 * `<command-args>`) XML; a plain prompt has none. Robust to partial/missing tags:
 * an unclosed `<command-name>` is treated as plain text. When it IS a command,
 * `rest` is the surrounding free text with all three tags removed.
 */
export function parseSlashCommand(text: string | null): ParsedPrompt {
  if (text === null) return NON_SLASH("");
  const name = tagContent(text, "command-name");
  if (name === null) return NON_SLASH(text);

  const rest = text
    .replace(/<command-(name|message|args)>[\s\S]*?<\/command-\1>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return {
    isSlashCommand: true,
    commandName: name,
    commandArgs: tagContent(text, "command-args"),
    rest,
  };
}

/**
 * Correlate an Agent tool call to the sub-agent node it spawned, for the
 * "Open transcript →" deep-link and the exact spawned cost. Walks the whole
 * `tree` for the node whose `spawnedByToolUseId` matches the call's `toolUseId`
 * (the reliable key); failing that, falls back to `spawnedByMessageId` matching
 * the assistant turn's message id. Returns `null` when nothing correlates (e.g.
 * a spawn whose sub-agent transcript was not captured).
 */
export function findSpawnedNode(
  tree: TranscriptAgentNode,
  call: { toolUseId: string | null; messageId: number },
): TranscriptAgentNode | null {
  // Pre-order search of the descendants (the root itself is never a spawn).
  const find = (match: (node: TranscriptAgentNode) => boolean): TranscriptAgentNode | null => {
    const walk = (node: TranscriptAgentNode): TranscriptAgentNode | null => {
      if (match(node)) return node;
      for (const child of node.children) {
        const found = walk(child);
        if (found) return found;
      }
      return null;
    };
    for (const child of tree.children) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };

  // The tool_use id is the precise correlation (a single turn may spawn several
  // agents, so the message id alone is ambiguous); only fall back to it when the
  // tool call has no recorded tool_use id.
  const byToolUse = call.toolUseId !== null ? find((node) => node.spawnedByToolUseId === call.toolUseId) : null;
  if (byToolUse) return byToolUse;
  return find((node) => node.spawnedByMessageId === call.messageId);
}

/**
 * How a transcript's per-turn reasoning effort reads as a whole (see
 * {@link effortSummary}).
 */
export type EffortSummary = {
  /**
   * The single level every effort-carrying turn agrees on — the header stat.
   * Null when the transcript is `mixed` or when no turn carries effort at all.
   */
  uniform: string | null;
  /** True once two or more DISTINCT levels appear; the header then reads "mixed". */
  mixed: boolean;
  /**
   * Ids of the page's turns whose effort differs from the previous
   * effort-carrying turn, on this page or an earlier one — the only turns that
   * get a change badge. The agent's first effort-carrying turn is never in
   * here: the header stat is its baseline.
   */
  changedIds: Set<number>;
};

/**
 * Classify a transcript's reasoning effort for the pane: the header stat
 * (uniform level vs `mixed`), read from the WHOLE agent's distinct `levels`,
 * and the turns of this Transcript page that changed it, compared from
 * `before` — the effort carried on an earlier page (null on page 1).
 *
 * Turns carrying NO effort are ignored entirely — user prompts have none, and
 * roughly half of real assistant lines predate the field. A null therefore
 * neither makes a transcript `mixed` nor counts as a change; comparisons always
 * run against the previous EFFORT-CARRYING turn. Levels are compared as raw
 * strings and never validated, so a future level (`low`, `max`, …) flows
 * through to the UI verbatim.
 *
 * @example effortSummary(view.messages, { levels: view.effortLevels, before: view.effortBefore })
 */
export function effortSummary(
  messages: { id: number; effort: string | null }[],
  agent: { levels: string[]; before: string | null },
): EffortSummary {
  const changedIds = new Set<number>();
  let previous = agent.before;

  for (const message of messages) {
    const effort = message.effort;
    if (effort === null) continue;
    if (previous !== null && effort !== previous) changedIds.add(message.id);
    previous = effort;
  }

  const mixed = agent.levels.length > 1;
  return { uniform: mixed ? null : (agent.levels[0] ?? null), mixed, changedIds };
}

/**
 * The ancestor chain (root → selected) for `selectedId` within the agent `tree`,
 * for the transcript pane's breadcrumb. Returns the path inclusive of both ends,
 * or `[]` when the id is not in the tree.
 */
export function agentLineage(tree: TranscriptAgentNode, selectedId: string): TranscriptAgentNode[] {
  const path: TranscriptAgentNode[] = [];
  const walk = (node: TranscriptAgentNode): boolean => {
    path.push(node);
    if (node.id === selectedId) return true;
    for (const child of node.children) {
      if (walk(child)) return true;
    }
    path.pop();
    return false;
  };
  return walk(tree) ? path : [];
}

/**
 * A tool call's input or result text for display: a JSON object or array is
 * pretty-printed with two-space indents; anything else — plain text, a JSON
 * scalar, a result cut off mid-JSON by the stored-length cap — comes back
 * verbatim.
 *
 * @example prettyToolText('{"agentId":"dx"}') // '{\n  "agentId": "dx"\n}'
 */
export function prettyToolText(text: string): string {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed !== null && typeof parsed === "object" ? JSON.stringify(parsed, null, 2) : text;
  } catch {
    return text;
  }
}

/** How one agent of the tree is named on screen (see {@link agentLabels}). */
export type AgentLabel = {
  /** "main" for the main thread, else the sub-agent's type. */
  name: string;
  /** 1-based spawn position among same-named siblings; null when the name is unique there. */
  ordinal: number | null;
};

/**
 * The display name of every agent in the tree, keyed by agent id.
 *
 * @example agentLabels(view.tree).get(view.selectedAgentId) // { name: "Plan", ordinal: 2 }
 */
export function agentLabels(tree: TranscriptAgentNode): Map<string, AgentLabel> {
  const nameOf = (node: TranscriptAgentNode) => subAgentLabel({ agentType: node.agentType ?? "" });
  const labels = new Map<string, AgentLabel>([[tree.id, { name: nameOf(tree), ordinal: null }]]);
  // Ordinals count among one parent's children only (already in spawn order).
  const walkChildren = (parent: TranscriptAgentNode): void => {
    const names = parent.children.map(nameOf);
    const seen = new Map<string, number>();
    parent.children.forEach((child, i) => {
      const name = names[i];
      const position = (seen.get(name) ?? 0) + 1;
      seen.set(name, position);
      const repeated = names.indexOf(name) !== names.lastIndexOf(name);
      labels.set(child.id, { name, ordinal: repeated ? position : null });
      walkChildren(child);
    });
  };
  walkChildren(tree);
  return labels;
}

/**
 * True when any agent in the tree ran on a model without a known price — the
 * conversation total is then a lower bound.
 *
 * @example hasUnpricedAgent(view.tree) ? `~${formatCost(view.totalCostUsd)}` : formatCost(view.totalCostUsd)
 */
export function hasUnpricedAgent(tree: TranscriptAgentNode): boolean {
  return tree.unpriced || tree.children.some(hasUnpricedAgent);
}
