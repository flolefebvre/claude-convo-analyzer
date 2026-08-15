import Link from "next/link";
import { Suspense } from "react";

import { TranscriptPane } from "@/app/_components/transcript/transcript-pane";
import { TranscriptTree } from "@/app/_components/transcript/transcript-tree";
import { loadFamily, loadTranscript } from "@/app/_lib/conversations";
import { resolveAgent, resolveCall, resolveMessage } from "@/app/_lib/transcript-url";

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

  const family = await loadFamily(sessionId);

  return (
    <div className="tview">
      <TranscriptTree view={view} />
      <TranscriptPane
        view={view}
        family={family}
        anchoredCall={resolveCall(call)}
        anchoredMessage={resolveMessage(msg)}
      />
    </div>
  );
}

function TranscriptLoading() {
  return (
    <div className="tview-empty">
      <p className="text-sm text-muted-foreground">Loading transcript…</p>
    </div>
  );
}

function NotFoundState({ sessionId }: { sessionId: string }) {
  return (
    <div className="tview-empty">
      <h1 className="text-lg font-semibold">Conversation not found</h1>
      <p className="text-sm text-muted-foreground">
        No conversation matches <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{sessionId}</code>.
      </p>
      <Link href="/" className="text-sm font-medium hover:underline">
        ← All conversations
      </Link>
    </div>
  );
}
