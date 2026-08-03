// Render-ready shaping for the API-error section of the expanded detail panel
// (issue #47). Like its sibling `_lib` modules this is pure — React-free,
// I/O-free, only type-only core imports (ADR-0002) — so the labeling and the
// deep-link composition unit-test in the node environment and the panel
// component stays a thin renderer.

import type { ConversationApiError } from "@/core/errors";

import { subAgentLabel } from "@/app/_lib/detail";
import { formatClock, formatDate } from "@/app/_lib/format";
import { messageHref } from "@/app/_lib/transcript-url";

/** One failed turn, ready to render as a row of the panel's error list. */
export type ErrorViewRow = {
  /** Stable React key — errors can repeat an agent, and a uuid may be missing. */
  key: string;
  /** Which agent failed: "main" for the root thread, else the sub-agent type. */
  agentLabel: string;
  /** Wall-clock `HH:MM` of the failed turn; `""` when the log had no timestamp. */
  timeLabel: string;
  /** The full moment, for the hover title; `""` when there is no timestamp. */
  timeAbsolute: string;
  /** The API status verbatim (`overloaded_error`, …); null when not recorded. */
  status: string | null;
  /** The failed turn's text excerpt (already capped by the core); may be `""`. */
  excerpt: string;
  /** Where clicking goes: that message, in that agent's transcript. */
  href: string;
};

/**
 * Shape one conversation's {@link ConversationApiError}s into panel rows.
 *
 * Order comes from the core read (oldest first), so this only formats: the
 * agent label (reusing the panel's own root → "main" rule), the clock, and the
 * message deep link. An error whose record carried no uuid still lists — its
 * link degrades to the agent's transcript rather than disappearing.
 */
export function errorsView(
  sessionId: string,
  errors: readonly ConversationApiError[],
): ErrorViewRow[] {
  return errors.map((error, index) => ({
    key: `${index}-${error.agentId}-${error.messageUuid ?? ""}`,
    agentLabel: subAgentLabel({ agentType: error.agentType ?? "" }),
    timeLabel: formatClock(error.timestamp || null),
    timeAbsolute: formatDate(error.timestamp || null).absolute,
    status: error.status,
    excerpt: error.excerpt,
    href: messageHref(sessionId, error.agentId, error.messageUuid),
  }));
}
