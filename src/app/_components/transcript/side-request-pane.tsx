import { PendingLink } from "@/app/_components/pending-link";
import { formatClock } from "@/app/_lib/format";
import { SIDE_REQUESTS_TOOLTIP, sideRequestKindLabel, sideRequestLabel } from "@/app/_lib/side-requests";
import { agentHref, withListReturn } from "@/app/_lib/transcript-url";
import type { TranscriptSideRequest, TranscriptView } from "@/core/read";

import { CostFigure, PaneHeader } from "./transcript-parts";
import { WhatWasSentDisclosure } from "./transcript-what-was-sent";

/**
 * The right pane when the reader picked a Side request in the agent tree
 * (`?sideRequest=`): a sticky header naming it — its kind, time and cost —
 * then the same "What was sent" panel a recorded Turn has, open and read at
 * once. The breadcrumb's first crumb leads back to the main thread.
 *
 * @example <SideRequestPane view={view} sideRequest={sideRequest} listReturn={listReturn} />
 */
export function SideRequestPane({
  view,
  sideRequest,
  listReturn,
}: {
  view: TranscriptView;
  sideRequest: TranscriptSideRequest;
  /** The list view this transcript was opened from (`?from=`), carried on the way back to the transcript. */
  listReturn?: string;
}) {
  const label = sideRequestLabel(sideRequest);
  return (
    <>
      <PaneHeader
        title={view.title}
        crumbLabel="Side request"
        crumbs={
          <>
            <PendingLink href={withListReturn(agentHref(view.sessionId), listReturn)}>main</PendingLink>
            <span className="sep" aria-hidden>
              /
            </span>
            <span className="term" title={SIDE_REQUESTS_TOOLTIP}>
              Side requests
            </span>
            <span className="sep" aria-hidden>
              /
            </span>
            <span className="here" aria-current="page" title={label}>
              {label}
            </span>
          </>
        }
        stats={
          <>
            <span>{sideRequestKindLabel(sideRequest.kind)}</span>
            <span title={sideRequest.arrivedAt}>{formatClock(sideRequest.arrivedAt)}</span>
            <CostFigure usd={sideRequest.costUsd} lowerBound={sideRequest.unpriced} className="stat-cost" />
          </>
        }
      />

      <h2 className="sr-only">{label}: what was sent</h2>
      <div className="transcript">
        {/* Keyed by the API request: picking another Side request only changes
            `?sideRequest=`, which keeps state, so a fresh mount reads anew. */}
        <WhatWasSentDisclosure
          key={sideRequest.apiRequestId}
          apiRequestId={sideRequest.apiRequestId}
          failedAttemptCount={0}
          isOpenInitially
        />
      </div>
    </>
  );
}
