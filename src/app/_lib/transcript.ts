import type { TranscriptAgentNode } from "@/core/read";

import { formatTokens } from "@/app/_lib/format";

export const RESULT_TRUNCATE_CHARS = 10_000;

const SNIPPET_MAX = 140;

export type TranscriptCallKind = "agent" | "skill" | "tool";

export function classifyToolCall(call: { name: string }): TranscriptCallKind {
  if (call.name === "Agent") return "agent";
  if (call.name === "Skill") return "skill";
  return "tool";
}

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

function firstStringField(input: Record<string, unknown>): string {
  for (const value of Object.values(input)) {
    if (typeof value === "string" && value !== "") return value;
  }
  return "";
}

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > SNIPPET_MAX ? `${flat.slice(0, SNIPPET_MAX - 1)}…` : flat;
}

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

export function truncationNote(call: { resultTruncated: boolean; resultCharSize: number | null }): string | null {
  if (!call.resultTruncated) return null;
  const stored = `stored first ${formatTokens(RESULT_TRUNCATE_CHARS)}`;
  return call.resultCharSize === null ? stored : `${formatTokens(call.resultCharSize)} chars total — ${stored}`;
}

export type ParsedPrompt = {
  isSlashCommand: boolean;
  commandName: string | null;
  commandArgs: string | null;
  rest: string;
};

const NON_SLASH = (rest: string): ParsedPrompt => ({
  isSlashCommand: false,
  commandName: null,
  commandArgs: null,
  rest,
});

function tagContent(text: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text);
  return match ? match[1].trim() : null;
}

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

export function findSpawnedNode(
  tree: TranscriptAgentNode,
  call: { toolUseId: string | null; messageId: number },
): TranscriptAgentNode | null {
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

  const byToolUse = call.toolUseId !== null ? find((node) => node.spawnedByToolUseId === call.toolUseId) : null;
  if (byToolUse) return byToolUse;
  return find((node) => node.spawnedByMessageId === call.messageId);
}

export type EffortSummary = {
  uniform: string | null;
  mixed: boolean;
  changedIds: Set<number>;
};

export function effortSummary(messages: { id: number; effort: string | null }[]): EffortSummary {
  const changedIds = new Set<number>();
  let previous: string | null = null;
  let mixed = false;

  for (const message of messages) {
    const effort = message.effort;
    if (effort === null) continue;
    if (previous !== null && effort !== previous) {
      changedIds.add(message.id);
      mixed = true;
    }
    previous = effort;
  }

  return { uniform: mixed ? null : previous, mixed, changedIds };
}

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
