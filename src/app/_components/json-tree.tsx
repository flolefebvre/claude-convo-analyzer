"use client";

// A JSON value as a tree of native `<details>`, like the transcript's tool
// calls: each object and array expands and collapses on its own, and its
// children render only while it is open, so a body of hundreds of KB costs
// one row per top-level field until the reader digs in. Styled by the
// `.tview .json-*` rules in `globals.css`.

import { ChevronRight } from "lucide-react";
import { useState } from "react";

import type { JsonValue } from "@/app/_lib/transcript";

/** How many characters of a string show before it is clamped behind "show all". */
const STRING_CLAMP_CHARS = 300;

/**
 * `value` as a collapsible tree: an object or array renders its direct
 * children, each nested object or array collapsed; any other value renders
 * as itself.
 *
 * @example <JsonTree value={rawApiRequest.requestBody} />
 */
export function JsonTree({ value }: { value: JsonValue }) {
  return (
    <div className="json-tree">{isContainer(value) ? <Children container={value} /> : <Scalar value={value} />}</div>
  );
}

/** An object or an array: what has children. */
type JsonContainer = JsonValue[] | { [key: string]: JsonValue };

function isContainer(value: JsonValue): value is JsonContainer {
  return typeof value === "object" && value !== null;
}

/** The entries of `container`: an object's fields by name, an array's items by index. */
function Children({ container }: { container: JsonContainer }) {
  const entries = Array.isArray(container)
    ? container.map((item, index) => [String(index), item] as const)
    : Object.entries(container);
  return (
    <ul className="json-children">
      {entries.map(([name, value]) => (
        <li key={name}>
          <Entry name={name} value={value} />
        </li>
      ))}
    </ul>
  );
}

/** One field or item: a non-empty object or array as a collapsed node, anything else on one line. */
function Entry({ name, value }: { name: string; value: JsonValue }) {
  const [isOpen, setIsOpen] = useState(false);
  if (!isContainer(value) || containerSize(value) === 0) {
    return (
      <div className="json-entry">
        <span className="json-key">{name}:</span> <Scalar value={value} />
      </div>
    );
  }
  return (
    <details className="json-node" onToggle={(event) => setIsOpen(event.currentTarget.open)}>
      <summary>
        <ChevronRight aria-hidden className="chev" />
        <span className="json-key">{name}</span>
        <span className="json-summary">{containerSummary(value)}</span>
      </summary>
      {isOpen && <Children container={value} />}
    </details>
  );
}

function containerSize(container: JsonContainer): number {
  return Array.isArray(container) ? container.length : Object.keys(container).length;
}

/** `[3 items]`, `{1 key}`. */
function containerSummary(container: JsonContainer): string {
  const size = containerSize(container);
  return Array.isArray(container) ? `[${size} item${size === 1 ? "" : "s"}]` : `{${size} key${size === 1 ? "" : "s"}}`;
}

/** A value on one line: an empty object or array as `{}` or `[]`, a string quoted and clamped, any other as JSON. */
function Scalar({ value }: { value: JsonValue }) {
  if (typeof value === "string") return <StringValue text={value} />;
  if (isContainer(value)) return <span className="json-punctuation">{Array.isArray(value) ? "[]" : "{}"}</span>;
  return <span className={`json-${value === null ? "null" : typeof value}`}>{String(value)}</span>;
}

/** A string between quotes, its line breaks kept; past {@link STRING_CLAMP_CHARS} characters, clamped with "show all". */
function StringValue({ text }: { text: string }) {
  const [isShownWhole, setIsShownWhole] = useState(false);
  const isClamped = text.length > STRING_CLAMP_CHARS && !isShownWhole;
  return (
    <span className="json-string">
      &quot;{isClamped ? `${text.slice(0, STRING_CLAMP_CHARS)}…` : text}&quot;
      {text.length > STRING_CLAMP_CHARS && (
        <button type="button" className="json-clamp-toggle" onClick={() => setIsShownWhole(!isShownWhole)}>
          {isShownWhole ? "show less" : `show all ${text.length.toLocaleString("en-US")} characters`}
        </button>
      )}
    </span>
  );
}
