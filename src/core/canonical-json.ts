// The one canonical JSON form: what a piece is hashed in, whether a Recording
// stores it (docs/recording-format.md, "Hashing rule") or the conversation logs
// do (docs/conversation-log-format.md, §9). Node built-ins only.

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
