import { Pager } from "@/app/_components/pager";
import { pageRange } from "@/app/_lib/list-view";
import { transcriptPageHref } from "@/app/_lib/transcript-url";
import type { TranscriptView } from "@/core/read";

/**
 * Previous / Next between the selected agent's Transcript pages ("201–400 of
 * 450 messages"), under the messages. Each end keeps the agent and the
 * `?from=` list view and drops any `?msg=`/`?call=` anchor. Renders nothing on
 * a one-page transcript.
 *
 * @example <TranscriptPager view={view} listReturn={listReturn} />
 */
export function TranscriptPager({
  view,
  listReturn,
  className,
}: {
  view: TranscriptView;
  /** The list view this transcript was opened from (`?from=`). */
  listReturn?: string;
  className?: string;
}) {
  const { page, pageCount, pageSize, messageCount } = view;
  // The root agent's link carries no `?agent=`, as in the tree.
  const agentId = view.selectedAgentId === view.tree.id ? undefined : view.selectedAgentId;
  const href = (target: number) => transcriptPageHref(view.sessionId, agentId, target, listReturn);
  const { first, last } = pageRange(page, messageCount, pageSize);
  return (
    <Pager
      prevHref={page > 1 ? href(page - 1) : undefined}
      nextHref={page < pageCount ? href(page + 1) : undefined}
      first={first}
      last={last}
      total={messageCount}
      noun="messages"
      label="Transcript pages"
      className={className}
    />
  );
}
