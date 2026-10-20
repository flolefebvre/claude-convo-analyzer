// The Transcript view — `/conversation/<sessionId>` (issue: transcript view). A
// React Server Component that renders an IDE-like two-pane layout for ONE
// conversation: an always-visible agent-tree sidebar (left) and the selected
// agent's transcript (right). The selected agent lives in `?agent=<id>`; absent,
// the core reader defaults to the main thread.
//
// This route sits OUTSIDE the `(shell)` route group, so it is NOT wrapped in the
// folder sidebar — below the shared app bar it brings its own full-bleed
// two-pane frame instead.
//
// The frame (the `<aside>` and `<main>` landmarks) reads nothing, so it is the
// static shell; `params` and `searchParams` are only awaited inside the
// <Suspense> boundaries, which stream in behind their skeletons: the back link
// (it reads only `?from=`), the agent tree, and the transcript pane. The two
// data regions share one cached `loadTranscript` read, and either one turns an
// unknown session id into the not-found page; `generateMetadata` does too, so
// such a page never carries a conversation's title.
//
// A Tools-page drill-down can deep-link into ONE tool call here
// (`?agent=<id>&call=<toolUseId>#call-<toolUseId>`): `?call=` opens and
// highlights that call server-side, and the pane's `ScrollToAnchor` scrolls to
// it once it streams in. The fragment stays for copied links and no-JS.
//
// The pane shows one Transcript page (`?page=`, page 1 the bare URL). A
// deep link carries no page: core opens the page holding its anchor.
//
// A Side request picked in the tree (`?sideRequest=<api_request id>`) takes
// the pane instead: what it sent, in the same panel as a recorded Turn's.
//
// The transcript read goes through the cached/`connection()`-gated
// `loadTranscript` seam (ADR-0002 — the component never touches core/DB
// directly).

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { LoadingRegion } from "@/app/_components/loading-region";
import { SideRequestPane } from "@/app/_components/transcript/side-request-pane";
import { TranscriptPane } from "@/app/_components/transcript/transcript-pane";
import { BackLink, TranscriptTree } from "@/app/_components/transcript/transcript-tree";
import { loadConversations, loadFamily, loadTranscript } from "@/app/_lib/conversations";
import { activeNowUntil } from "@/app/_lib/live";
import { resolvePage } from "@/app/_lib/search-params";
import { agentLabels } from "@/app/_lib/transcript";
import {
  resolveAgent,
  resolveCall,
  resolveListReturn,
  resolveMessage,
  resolveSideRequest,
} from "@/app/_lib/transcript-url";
import { Skeleton } from "@/components/ui/skeleton";

/** The route's URL view-state: which agent, which Transcript page, which
 *  anchored call/message, and the list view it was opened from. */
type TranscriptSearchParams = {
  agent?: string | string[];
  page?: string | string[];
  call?: string | string[];
  msg?: string | string[];
  from?: string | string[];
  sideRequest?: string | string[];
};

/** The route inputs, as Next hands them over. */
type RouteProps = {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<TranscriptSearchParams>;
};

/** The tab title is the conversation's own title. */
export async function generateMetadata({ params }: { params: Promise<{ sessionId: string }> }): Promise<Metadata> {
  const { sessionId } = await params;
  const row = (await loadConversations()).find((conversation) => conversation.id === sessionId);
  if (row === undefined) notFound();
  return { title: row.title ?? "Untitled conversation" };
}

export default function ConversationPage({ params, searchParams }: RouteProps) {
  return (
    <div className="tview">
      <aside className="tree" aria-label="Agent tree">
        <div className="tree-back">
          <Suspense fallback={<BackLinkFallback />}>
            <TranscriptBackLink searchParams={searchParams} />
          </Suspense>
        </div>
        <Suspense fallback={<TreeFallback />}>
          <TreeRegion params={params} searchParams={searchParams} />
        </Suspense>
      </aside>
      <main id="main" tabIndex={-1} className="pane">
        <Suspense fallback={<PaneFallback />}>
          <PaneRegion params={params} searchParams={searchParams} />
        </Suspense>
      </main>
    </div>
  );
}

/**
 * Awaits the route inputs and the selected agent's transcript; an unknown
 * session is the not-found page. `loadTranscript` is `cache()`d, so the tree and
 * the pane share one read.
 */
async function readRoute({ params, searchParams }: RouteProps) {
  const { sessionId } = await params;
  const { agent, page, call, msg, from, sideRequest } = await searchParams;
  const anchoredCall = resolveCall(call);
  const anchoredMessage = resolveMessage(msg);
  // With no `?page=`, core opens the Transcript page holding the anchor.
  const view = await loadTranscript(sessionId, resolveAgent(agent), resolvePage(page), anchoredMessage, anchoredCall);
  if (view === null) notFound();
  // Both panes name agents the same way ("Plan #2" when siblings share a type).
  const labels = agentLabels(view.tree);
  // `?sideRequest=` picks a Side request of this Conversation for the pane; an
  // id it no longer has (re-parsed since) leaves the agent's transcript there.
  const sideRequestId = resolveSideRequest(sideRequest);
  const selectedSideRequest = view.sideRequests.find((s) => s.apiRequestId === sideRequestId);
  // A transcript opened from the list carries that list view (`?from=`): every
  // link to another transcript passes it on.
  return { view, labels, anchoredCall, anchoredMessage, selectedSideRequest, listReturn: resolveListReturn(from).from };
}

/** The back link restores the list view the transcript was opened from (`?from=`). */
async function TranscriptBackLink({ searchParams }: Pick<RouteProps, "searchParams">) {
  const { from } = await searchParams;
  return <BackLink href={resolveListReturn(from).href} />;
}

async function TreeRegion(props: RouteProps) {
  const { view, labels, selectedSideRequest, listReturn } = await readRoute(props);
  return (
    <TranscriptTree
      view={view}
      labels={labels}
      lowerBound={view.hasUnpriced}
      listReturn={listReturn}
      selectedSideRequestId={selectedSideRequest?.apiRequestId}
      activeUntil={activeNowUntil(view.sourceChangedAt, new Date())}
    />
  );
}

async function PaneRegion(props: RouteProps) {
  const { view, labels, anchoredCall, anchoredMessage, selectedSideRequest, listReturn } = await readRoute(props);
  if (selectedSideRequest !== undefined) {
    return <SideRequestPane view={view} sideRequest={selectedSideRequest} listReturn={listReturn} />;
  }
  // The continuation lineage of this session (issue #46): the pane shows its
  // DIRECT parent/continuations as a banner. Standalone sessions get `size === 1`
  // and no banner at all.
  const family = await loadFamily(view.sessionId);
  // `?call=` is how a Tools-page drill-down points at ONE tool call: the pane
  // renders it open and highlighted (server-side, because a fragment never
  // reaches the server), and its `ScrollToAnchor` scrolls to it.
  return (
    <TranscriptPane
      view={view}
      labels={labels}
      family={family}
      anchoredCall={anchoredCall}
      anchoredMessage={anchoredMessage}
      listReturn={listReturn}
    />
  );
}

/** The back link's skeleton, the size of the link. */
function BackLinkFallback() {
  return (
    <LoadingRegion label="Loading back link">
      <Skeleton className="h-3.5 w-30" />
    </LoadingRegion>
  );
}

/** The agent tree's skeleton: the conversation header, a few nodes, the total. */
function TreeFallback() {
  return (
    <LoadingRegion label="Loading agent tree">
      <div className="tree-header">
        <Skeleton className="mb-1.5 h-5 w-48" />
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="tree-caption">
        <Skeleton className="h-4 w-12" />
      </div>
      <div className="tree-nodes">
        {[0, 1, 1].map((depth, index) => (
          <Skeleton key={index} className="h-8" style={{ marginLeft: depth * 16 }} />
        ))}
      </div>
      <div className="tree-total">
        <Skeleton className="h-5" />
      </div>
    </LoadingRegion>
  );
}

/** The transcript pane's skeleton: the sticky header strip, then a few messages. */
function PaneFallback() {
  return (
    <LoadingRegion label="Loading transcript">
      <div className="pane-header">
        <div className="pane-header-inner">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="ml-auto h-4 w-56" />
        </div>
      </div>
      <div className="transcript">
        {["h-10", "h-24", "h-10", "h-32"].map((height, index) => (
          <div key={index}>
            <Skeleton className="mb-1 h-4 w-40" />
            <Skeleton className={height} />
          </div>
        ))}
      </div>
    </LoadingRegion>
  );
}
