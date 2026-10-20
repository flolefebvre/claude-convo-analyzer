// Tool-call views (GLOSSARY.md, "Tool call"): how an opened Tool call's body
// reads. Each block — the input, and separately the stored result — becomes an
// ordered list of parts. A tool's view is its own entry in the table below,
// keyed by tool name; a tool without one, or a text its entry can't read, shows
// the single raw part. Framework-free (ADR-0002).

/**
 * One key/value line of a facts part, its value typed by what it is: text, a
 * duration, or a count. Numbers stay numbers; the app formats them.
 */
export type ToolCallFact =
  { key: string; value: string } | { key: string; durationMs: number } | { key: string; count: number };

/**
 * One display part of a Tool call's body block: key/value facts, one
 * agent-written markdown text, or the block's stored text shown raw — a raw
 * part carries no text, the block's own stored text is what it shows.
 */
export type ToolCallPart =
  { kind: "facts"; facts: ToolCallFact[] } | { kind: "markdown"; text: string } | { kind: "raw" };

/** The parts of a Tool call's input block and result block; no result parts until it is answered. */
export type ToolCallBodyParts = { inputParts: ToolCallPart[]; resultParts: ToolCallPart[] | null };

/** A tool's view: its input object, and separately its result text, as parts; an absent side shows raw. */
type ToolCallView = {
  input?: (input: Record<string, unknown>) => ToolCallPart[];
  result?: (resultText: string) => ToolCallPart[];
};

const RAW_PARTS: ToolCallPart[] = [{ kind: "raw" }];

/** The input's scalar fields other than `excludedKeys`, in input order; missing, null and empty ones are left out. */
function scalarFacts(input: Record<string, unknown>, excludedKeys: readonly string[]): ToolCallFact[] {
  const facts: ToolCallFact[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (excludedKeys.includes(key)) continue;
    if (typeof value === "string" ? value !== "" : typeof value === "number" || typeof value === "boolean") {
      facts.push({ key, value: String(value) });
    }
  }
  return facts;
}

/**
 * The input's other scalar fields as one facts part, then its `markdownKey`
 * field as a markdown part; each left out when it has nothing to show.
 */
function factsThenMarkdown(input: Record<string, unknown>, markdownKey: string): ToolCallPart[] {
  const facts = scalarFacts(input, [markdownKey]);
  const parts: ToolCallPart[] = facts.length > 0 ? [{ kind: "facts", facts }] : [];
  const text = input[markdownKey];
  if (typeof text === "string" && text !== "") parts.push({ kind: "markdown", text });
  return parts;
}

/**
 * A Sub-agent's hand-back in its spawn ledger: the report it sent as a message
 * when there is one (`content` then only points at it), else `content`'s text
 * blocks; `""` when it wrote none.
 */
function handBackText(ledger: Record<string, unknown>): string {
  const report = ledger.handbackReport as { text?: unknown } | null | undefined;
  if (typeof report?.text === "string" && report.text !== "") return report.text;
  if (!Array.isArray(ledger.content)) return "";
  return (ledger.content as unknown[])
    .flatMap((block) => {
      const b = block as { type?: unknown; text?: unknown } | null;
      return b?.type === "text" && typeof b.text === "string" && b.text !== "" ? [b.text] : [];
    })
    .join("\n\n");
}

/** A completed Sub-agent's facts — its status, then the ledger's totals that are numbers. */
function completedFacts(ledger: Record<string, unknown>): ToolCallFact[] {
  const facts: ToolCallFact[] = [{ key: "status", value: "completed" }];
  if (typeof ledger.totalDurationMs === "number") facts.push({ key: "duration", durationMs: ledger.totalDurationMs });
  if (typeof ledger.totalTokens === "number") facts.push({ key: "tokens", count: ledger.totalTokens });
  if (typeof ledger.totalToolUseCount === "number") facts.push({ key: "tool uses", count: ledger.totalToolUseCount });
  return facts;
}

/** The view of every tool that has one, keyed by tool name. */
const TOOL_CALL_VIEW_BY_TOOL_NAME: Record<string, ToolCallView> = {
  // The Task prompt and the hand-back are agent-written prose; the rest of the
  // spawn ledger (usage, toolStats, the echoed prompt) is left to Raw.
  Agent: {
    input: (input) => factsThenMarkdown(input, "prompt"),
    result: (resultText) => {
      const ledger = parseJsonObject(resultText);
      if (ledger?.status === "async_launched") {
        return [{ kind: "facts", facts: [{ key: "status", value: "launched in the background" }] }];
      }
      if (ledger?.status !== "completed") return [];
      const parts: ToolCallPart[] = [{ kind: "facts", facts: completedFacts(ledger) }];
      const text = handBackText(ledger);
      if (text !== "") parts.push({ kind: "markdown", text });
      return parts;
    },
  },
  // The message is agent-written prose; the delivery receipt is flat JSON
  // (`success`, `message`, `msg_id`), any nested field left to Raw.
  SendMessage: {
    input: (input) => factsThenMarkdown(input, "message"),
    result: (resultText) => {
      const receipt = parseJsonObject(resultText);
      const facts = receipt === null ? [] : scalarFacts(receipt, []);
      return facts.length > 0 ? [{ kind: "facts", facts }] : [];
    },
  },
  // The plan is agent-written prose; the result (the approval echoing the
  // plan, or the rejection) is left to Raw.
  ExitPlanMode: {
    input: (input) => factsThenMarkdown(input, "plan"),
  },
};

/** `text` parsed as a JSON object, or `null` when it is malformed, cut off, or not an object. */
function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** The view's parts, or the single raw part when the view yields none. */
function partsOrRaw(parts: ToolCallPart[] | undefined): ToolCallPart[] {
  return parts !== undefined && parts.length > 0 ? parts : RAW_PARTS;
}

/**
 * The display parts of a Tool call's input and stored result, from its tool's
 * view; the single raw part for a tool with no view or a text it can't read.
 *
 * @example toolCallBodyParts({ name: "Agent", inputJson: '{"prompt":"# Task"}', resultText: null }) // { inputParts: [{ kind: "markdown", text: "# Task" }], resultParts: null }
 */
export function toolCallBodyParts(call: {
  name: string;
  inputJson: string;
  resultText: string | null;
}): ToolCallBodyParts {
  const view = TOOL_CALL_VIEW_BY_TOOL_NAME[call.name] as ToolCallView | undefined;
  const input = view?.input === undefined ? null : parseJsonObject(call.inputJson);
  return {
    inputParts: partsOrRaw(input === null ? undefined : view?.input?.(input)),
    resultParts: call.resultText === null ? null : partsOrRaw(view?.result?.(call.resultText)),
  };
}
