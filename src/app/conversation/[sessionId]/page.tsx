// The Transcript view — `/conversation/<sessionId>` (issue: transcript view). A
// React Server Component that renders an IDE-like two-pane layout for ONE
// conversation: an always-visible agent-tree sidebar (left) and the selected
// agent's transcript (right). The selected agent lives in `?agent=<id>`; absent,
// the core reader defaults to the main thread.
//
// This route sits OUTSIDE the `(shell)` route group, so it is NOT wrapped in the
// folder sidebar — below the shared app bar it brings its own full-bleed
// two-pane frame instead (see `TranscriptTree`).
//
// An unknown session id is a real 404: the page checks the id BEFORE any
// <Suspense> boundary, so `notFound()` runs before the response starts
// streaming and the status can still be set (Next local docs: loading.md
// "Status Codes"). That check blocks the route on purpose — hence
// `instant = false` — and costs one read of the conversation summaries, which
// the family banner needs anyway (React `cache()`). Only the transcript itself
// streams in behind the fallback.
//
// A Tools-page drill-down can deep-link into ONE tool call here
// (`?agent=<id>&call=<toolUseId>#call-<toolUseId>`): `?call=` opens and
// highlights that call server-side, the fragment does the scrolling.
//
// The transcript read goes through the cached/`connection()`-gated
// `loadTranscript` seam (ADR-0002 — the component never touches core/DB
// directly).

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { TranscriptPane } from "@/app/_components/transcript/transcript-pane";
import { TranscriptTree } from "@/app/_components/transcript/transcript-tree";
import { loadConversations, loadFamily, loadTranscript } from "@/app/_lib/conversations";
import { agentLabels, hasUnpricedAgent } from "@/app/_lib/transcript";
import { resolveAgent, resolveCall, resolveListReturn, resolveMessage } from "@/app/_lib/transcript-url";

/** The route's URL view-state: which agent, which anchored call/message, and
 *  the list view it was opened from. */
type TranscriptSearchParams = {
  agent?: string | string[];
  call?: string | string[];
  msg?: string | string[];
  from?: string | string[];
};

/** The route blocks on its existence check (see the header note). */
export const instant = false;

/** The tab title is the conversation's own title. */
export async function generateMetadata({ params }: { params: Promise<{ sessionId: string }> }): Promise<Metadata> {
  const { sessionId } = await params;
  const row = (await loadConversations()).find((conversation) => conversation.id === sessionId);
  return { title: row?.title ?? "Untitled conversation" };
}

export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<TranscriptSearchParams>;
}) {
  const { sessionId } = await params;
  // Every known session has a family (a standalone one is a family of one).
  if ((await loadFamily(sessionId)) === null) notFound();

  return (
    <Suspense fallback={<TranscriptLoading />}>
      <TranscriptRoute params={params} searchParams={searchParams} />
    </Suspense>
  );
}

/**
 * Awaits the route inputs and the transcript, then renders the two panes. Split
 * out from {@link ConversationPage} so the transcript read streams in behind the
 * page's <Suspense> boundary.
 */
async function TranscriptRoute({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<TranscriptSearchParams>;
}) {
  const { sessionId } = await params;
  const { agent, call, msg, from } = await searchParams;

  const view = await loadTranscript(sessionId, resolveAgent(agent));
  if (view === null) notFound();

  // The continuation lineage of this session (issue #46): the pane shows its
  // DIRECT parent/continuations as a banner. Standalone sessions get `size === 1`
  // and no banner at all.
  const family = await loadFamily(sessionId);
  // Both panes name agents the same way ("Plan #2" when siblings share a type).
  const labels = agentLabels(view.tree);
  // A transcript opened from the list carries that list view (`?from=`): the
  // back link restores it, and every link to another transcript passes it on.
  const back = resolveListReturn(from);

  // `?call=` is how a Tools-page drill-down points at ONE tool call: the pane
  // renders it open and highlighted, and the matching `#call-<id>` fragment
  // scrolls to it. Server-side, because a fragment never reaches the server.
  return (
    <div className="tview">
      <TranscriptTree view={view} labels={labels} lowerBound={hasUnpricedAgent(view.tree)} back={back} />
      <TranscriptPane
        view={view}
        labels={labels}
        family={family}
        anchoredCall={resolveCall(call)}
        anchoredMessage={resolveMessage(msg)}
        listReturn={back.from}
      />
    </div>
  );
}

/** The shell-only fallback while the transcript read streams in. */
function TranscriptLoading() {
  return (
    <main id="main" tabIndex={-1} className="tview-empty">
      <p className="text-sm text-muted-foreground">Loading transcript…</p>
    </main>
  );
}
