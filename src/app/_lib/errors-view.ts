import type { ConversationApiError } from "@/core/errors";

import { subAgentLabel } from "@/app/_lib/detail";
import { formatClock, formatDate } from "@/app/_lib/format";
import { messageHref } from "@/app/_lib/transcript-url";

export type ErrorViewRow = {
  key: string;
  agentLabel: string;
  timeLabel: string;
  timeAbsolute: string;
  status: string | null;
  excerpt: string;
  href: string;
};

export function errorsView(sessionId: string, errors: readonly ConversationApiError[]): ErrorViewRow[] {
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
