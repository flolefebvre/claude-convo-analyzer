// The Conversation export page — `/conversation/<sessionId>/export` (ADR-0008).
// Not a page anyone opens: `GET /api/conversation/<sessionId>/export` fetches
// it and turns it into the downloaded file. It renders every Agent's whole
// Transcript with the Transcript view's components, every Tool call body
// inlined: one section per Agent, each the Transcript view as it shows that
// Agent (its own copy of the agent tree, then its pane). The CSS shows the
// section the fragment targets — the main thread's with none — so the file
// switches Agents with no script.
//
// Everything is awaited outside any <Suspense>, so the whole Conversation is in
// the first HTML response rather than in streamed chunks only a script would
// put in place; hence `instant = false`: the route blocks until it is read.

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { TranscriptPane } from "@/app/_components/transcript/transcript-pane";
import { agentLabelText } from "@/app/_components/transcript/transcript-parts";
import { TranscriptTree } from "@/app/_components/transcript/transcript-tree";
import { loadConversationDetail, loadFamily, loadToolCallBodies, loadWholeTranscript } from "@/app/_lib/conversations";
import { agentLabels, agentsInTreeOrder } from "@/app/_lib/transcript";
import { agentSectionId } from "@/app/_lib/transcript-url";

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
  const [mainView, detail, family, toolCallBodyById] = await Promise.all([
    loadWholeTranscript(sessionId),
    loadConversationDetail(sessionId),
    loadFamily(sessionId),
    loadToolCallBodies(sessionId),
  ]);
  if (mainView === null || detail === null) notFound();
  const labels = agentLabels(mainView.tree);
  const subAgentViews = await Promise.all(
    agentsInTreeOrder(mainView.tree)
      .slice(1)
      .map((node) => loadWholeTranscript(sessionId, node.id)),
  );
  // A Sub-agent gone between the reads would render as the main thread: left out.
  const views = [
    mainView,
    ...subAgentViews.flatMap((view) =>
      view === null || view.selectedAgentId === mainView.selectedAgentId ? [] : [view],
    ),
  ];
  const exportHeaderFacts = {
    projectPath: detail.project.path,
    startedAt: detail.startedAt,
    models: detail.perModel.map((group) => group.model),
    exportedAt: new Date(),
  };

  return (
    <main className="agent-sections">
      {views.map((view) => (
        <section
          key={view.selectedAgentId}
          id={agentSectionId(view.selectedAgentId)}
          aria-label={`${agentLabelText(labels.get(view.selectedAgentId) ?? { name: "main", ordinal: null })} transcript`}
        >
          <div className="tview">
            <aside className="tree" aria-label="Agent tree">
              <div className="tree-back" />
              <TranscriptTree
                view={view}
                labels={labels}
                lowerBound={view.hasUnpriced}
                listReturn={undefined}
                exportHeaderFacts={exportHeaderFacts}
              />
            </aside>
            <div className="pane">
              <TranscriptPane view={view} labels={labels} family={family} transcriptExport={{ toolCallBodyById }} />
            </div>
          </div>
        </section>
      ))}
    </main>
  );
}
