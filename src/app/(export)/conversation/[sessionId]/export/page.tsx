// The Conversation export page — `/conversation/<sessionId>/export` (ADR-0008).
// Not a page anyone opens: `GET /api/conversation/<sessionId>/export` fetches
// it and turns it into the downloaded file. It renders the main thread's whole
// Transcript with the Transcript view's components, every Tool call body
// inlined and every link into the app as plain text.
//
// Everything is awaited outside any <Suspense>, so the whole Conversation is in
// the first HTML response rather than in streamed chunks only a script would
// put in place; hence `instant = false`: the route blocks until it is read.

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { TranscriptPane } from "@/app/_components/transcript/transcript-pane";
import { TranscriptTree } from "@/app/_components/transcript/transcript-tree";
import { loadConversationDetail, loadFamily, loadToolCallBodies, loadWholeTranscript } from "@/app/_lib/conversations";
import { agentLabels } from "@/app/_lib/transcript";

export const instant = false;

/** The route inputs, as Next hands them over. */
type RouteProps = { params: Promise<{ sessionId: string }> };

/** The file's title is the conversation's own title. */
export async function generateMetadata({ params }: RouteProps): Promise<Metadata> {
  const { sessionId } = await params;
  const detail = await loadConversationDetail(sessionId);
  if (detail === null) notFound();
  return { title: detail.title ?? "Untitled conversation" };
}

export default async function ConversationExportPage({ params }: RouteProps) {
  const { sessionId } = await params;
  const [view, detail, family, toolCallBodyById] = await Promise.all([
    loadWholeTranscript(sessionId),
    loadConversationDetail(sessionId),
    loadFamily(sessionId),
    loadToolCallBodies(sessionId),
  ]);
  if (view === null || detail === null) notFound();
  const labels = agentLabels(view.tree);

  return (
    <div className="tview">
      <aside className="tree" aria-label="Agent tree">
        <div className="tree-back" />
        <TranscriptTree
          view={view}
          labels={labels}
          lowerBound={view.hasUnpriced}
          listReturn={undefined}
          exportHeaderFacts={{
            projectPath: detail.project.path,
            startedAt: detail.startedAt,
            models: detail.perModel.map((group) => group.model),
            exportedAt: new Date(),
          }}
        />
      </aside>
      <main id="main" className="pane">
        <TranscriptPane view={view} labels={labels} family={family} transcriptExport={{ toolCallBodyById }} />
      </main>
    </div>
  );
}
