// The Transcript view — `/conversation/<sessionId>` (issue: transcript view). A
// React Server Component that renders an IDE-like two-pane layout for ONE
// conversation: an always-visible agent-tree sidebar (left) and the selected
// agent's transcript (right). The selected agent lives in `?agent=<id>`; absent,
// the core reader defaults to the main thread.
//
// This route sits OUTSIDE the `(list)` route group, so it is NOT wrapped in the
// list chrome (header + folder sidebar) — it brings its own full-bleed shell
// with an "All conversations" back-link instead (see `TranscriptTree`).
//
// A Tools-page drill-down can deep-link into ONE tool call here
// (`?agent=<id>&call=<toolUseId>#call-<toolUseId>`): `?call=` opens and
// highlights that call server-side, the fragment does the scrolling.
//
// Like the list page, the request-time reads (`params`/`searchParams` are both
// Promises in this Next.js) are awaited inside a <Suspense> boundary so the
// static shell can prerender while the DB-backed transcript streams in; the read
// itself goes through the cached/`connection()`-gated `loadTranscript` seam
// (ADR-0002 — the component never touches core/DB directly).

import Link from "next/link";
import { Suspense } from "react";

import { TranscriptPane } from "@/app/_components/transcript/transcript-pane";
import { TranscriptTree } from "@/app/_components/transcript/transcript-tree";
import { loadTranscript } from "@/app/_lib/conversations";
import {
  resolveAgent,
  resolveCall,
  resolveMessage,
} from "@/app/_lib/transcript-url";

/** The route's URL view-state: which agent, and which anchored call/message. */
type TranscriptSearchParams = {
  agent?: string | string[];
  call?: string | string[];
  msg?: string | string[];
};

export default function ConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<TranscriptSearchParams>;
}) {
  return (
    <Suspense fallback={<TranscriptLoading />}>
      <TranscriptRoute params={params} searchParams={searchParams} />
    </Suspense>
  );
}

/**
 * Awaits the route inputs and the transcript, then renders the two panes (or a
 * not-found state for an unknown session). Split out from {@link ConversationPage}
 * so the request-time data fetch sits inside the page's <Suspense> boundary.
 */
async function TranscriptRoute({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<TranscriptSearchParams>;
}) {
  const { sessionId } = await params;
  const { agent, call, msg } = await searchParams;

  const view = await loadTranscript(sessionId, resolveAgent(agent));
  if (view === null) return <NotFoundState sessionId={sessionId} />;

  // `?call=` is how a Tools-page drill-down points at ONE tool call: the pane
  // renders it open and highlighted, and the matching `#call-<id>` fragment
  // scrolls to it. Server-side, because a fragment never reaches the server.
  return (
    <div className="tview">
      <TranscriptTree view={view} />
      <TranscriptPane
        view={view}
        anchoredCall={resolveCall(call)}
        anchoredMessage={resolveMessage(msg)}
      />
    </div>
  );
}

/** The shell-only fallback while the transcript read streams in. */
function TranscriptLoading() {
  return (
    <div className="tview-empty">
      <p className="text-sm text-muted-foreground">Loading transcript…</p>
    </div>
  );
}

/** A clean not-found state for an unknown/absent session id. */
function NotFoundState({ sessionId }: { sessionId: string }) {
  return (
    <div className="tview-empty">
      <h1 className="text-lg font-semibold">Conversation not found</h1>
      <p className="text-sm text-muted-foreground">
        No conversation matches{" "}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
          {sessionId}
        </code>
        .
      </p>
      <Link
        href="/"
        className="text-sm font-medium hover:underline"
      >
        ← All conversations
      </Link>
    </div>
  );
}
