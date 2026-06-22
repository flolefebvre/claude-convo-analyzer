// Pure presentation helpers for the conversation list UI.
//
// This module is intentionally free of React, I/O, and any runtime dependency
// on `src/core` (the only core touch is a type-only import of `Tokens`, which
// is erased at compile time and so does not cross the ADR-0002 runtime
// boundary). Everything here takes plain data and returns plain strings/objects
// so it can be unit-tested in the node vitest environment.

import type { Tokens } from "@/core/cost";

/** Integer token count rendered with locale thousands separators. */
export function formatTokens(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/**
 * USD with adaptive precision so small costs stay legible.
 *
 * Rule:
 *   - exactly 0            -> "$0.00"
 *   - |value| >= 0.01      -> 2 decimal places ("$12.34", "$0.01")
 *   - 0 < |value| < 0.01   -> 4 decimal places ("$0.0042")
 *
 * The cutoff is 0.01 because that is the smallest value that renders
 * non-trivially at 2 dp; below it, 2 dp would collapse to "$0.00" and hide the
 * cost, so we widen to 4 dp.
 */
export function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  const decimals = Math.abs(usd) >= 0.01 ? 2 : 4;
  return `$${usd.toFixed(decimals)}`;
}

/**
 * Grand total in USD, always at 2 decimal places (per issue #3: "a grand total
 * at 2 dp"). Unlike {@link formatCost} this never widens precision — at the
 * aggregate level a sub-cent total rounds to "$0.00".
 */
export function formatGrandTotalCost(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

/**
 * Render an ISO8601 timestamp for the conversation list's Date column,
 * returning both a compact `label` and a full `absolute` string for hover.
 *
 * Pure: output depends ONLY on `iso` and `now` (production omits `now`, which
 * defaults to the wall clock). All calendar reasoning ("same day", "same year")
 * and the absolute string are computed in **UTC** so results are deterministic
 * regardless of the host timezone — tests pass a fixed `now` and fixed ISO
 * inputs and get stable output.
 *
 * Label rules (relative to `now`):
 *   - null / empty / unparseable -> "—" (em dash), absolute ""
 *   - same UTC calendar day  -> "just now" (< 1 min), "Nm ago" (< 60 min),
 *                               else "Nh ago"
 *   - same UTC calendar year -> "MMM d"        (e.g. "Jun 19")
 *   - earlier year           -> "MMM d yyyy"   (e.g. "Mar 4 2025")
 */
export function formatDate(
  iso: string | null,
  now: Date = new Date(),
): { label: string; absolute: string } {
  if (!iso) return { label: "—", absolute: "" };
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { label: "—", absolute: "" };

  return { label: relativeLabel(date, now), absolute: absoluteLabel(date) };
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function relativeLabel(date: Date, now: Date): string {
  const sameYear = date.getUTCFullYear() === now.getUTCFullYear();
  const sameDay =
    sameYear &&
    date.getUTCMonth() === now.getUTCMonth() &&
    date.getUTCDate() === now.getUTCDate();

  if (sameDay) {
    const diffMinutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
    if (diffMinutes < 1) return "just now";
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    return `${Math.floor(diffMinutes / 60)}h ago`;
  }

  const month = MONTHS[date.getUTCMonth()];
  const day = date.getUTCDate();
  if (sameYear) return `${month} ${day}`;
  return `${month} ${day} ${date.getUTCFullYear()}`;
}

/**
 * Deterministic absolute timestamp for the hover title, formatted in UTC via a
 * fixed Intl options object (e.g. "Jun 19, 2026, 14:30 UTC"). UTC + explicit
 * en-US locale keeps it independent of the host timezone/locale.
 */
function absoluteLabel(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date);
}

/** The minimal row shape {@link grandTotal} needs — a structural subset of
 * the core `ConversationSummary`, so callers can pass full summaries. */
export type GrandTotalRow = {
  tokens: Tokens;
  costUsd: number;
  unpriced: boolean;
};

/** Aggregate of a set of conversation rows for the table's footer. */
export type GrandTotal = {
  tokens: Tokens;
  costUsd: number;
  hasUnpriced: boolean;
};

/**
 * Sum tokens by bucket and costUsd across rows, flagging `hasUnpriced` if ANY
 * row is unpriced (so the UI can mark the total as a lower bound). Pure: no
 * mutation of inputs.
 */
export function grandTotal(rows: readonly GrandTotalRow[]): GrandTotal {
  const tokens: Tokens = {
    input: 0,
    output: 0,
    cacheWrite: 0,
    cacheRead: 0,
    total: 0,
  };
  let costUsd = 0;
  let hasUnpriced = false;

  for (const row of rows) {
    tokens.input += row.tokens.input;
    tokens.output += row.tokens.output;
    tokens.cacheWrite += row.tokens.cacheWrite;
    tokens.cacheRead += row.tokens.cacheRead;
    tokens.total += row.tokens.total;
    costUsd += row.costUsd;
    if (row.unpriced) hasUnpriced = true;
  }

  return { tokens, costUsd, hasUnpriced };
}
