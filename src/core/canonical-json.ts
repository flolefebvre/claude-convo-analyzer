// The one canonical JSON form: what a piece is hashed in, whether a Recording
// stores it (docs/recording-format.md, "Hashing rule") or the conversation logs
// do (docs/conversation-log-format.md, §9). Node built-ins only.

import { createHash } from "node:crypto";

/**
 * JSON with every object's keys sorted, no whitespace, non-ASCII kept as is,
 * so equal values serialize alike.
 *
 * @example
 * canonicalJson({ b: 1, a: [2] }); // '{"a":[2],"b":1}'
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, nested: unknown) =>
    isPlainObject(nested)
      ? Object.fromEntries(
          Object.keys(nested)
            .sort()
            .map((key) => [key, nested[key]]),
        )
      : nested,
  );
}

/**
 * The hash a logged API request's `tail` names `message` by
 * (docs/conversation-log-format.md §9, step 2): the sha256 hex of its
 * canonical JSON, a string `content` first rewritten as one text block.
 *
 * @example
 * sentMessageHash({ role: "user", content: "hi" }) === sentMessageHash({ role: "user", content: [{ type: "text", text: "hi" }] }); // true
 */
export function sentMessageHash(message: { role: string; content?: unknown }): string {
  const { content } = message;
  const hashed = typeof content === "string" ? { ...message, content: [{ type: "text", text: content }] } : message;
  return createHash("sha256").update(canonicalJson(hashed)).digest("hex");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
