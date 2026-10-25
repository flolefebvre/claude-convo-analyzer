"use client";

// The agent tree's "Export as HTML" control. The export route answers only once
// it has fetched and inlined the whole export page, which takes seconds on a
// large Conversation, so the control fetches it itself and shows that it is
// exporting until the file is downloaded. Before hydration it is a plain
// download link to the same route.

import { Download, LoaderCircle } from "lucide-react";
import { useState } from "react";

import { PendingButton } from "@/app/_components/pending-button";

/** What the file is saved as when the response names none; the route always names one. */
const FALLBACK_FILE_NAME = "conversation.html";

/**
 * "Export as HTML": downloads the Conversation `sessionId` as one
 * self-contained file, under the name the route gives it. While exporting it
 * reads "Exporting…" and ignores clicks; a failed export says so beside it.
 *
 * @example <ConversationExportButton sessionId={view.sessionId} />
 */
export function ConversationExportButton({ sessionId }: { sessionId: string }) {
  const exportHref = `/api/conversation/${encodeURIComponent(sessionId)}/export`;
  const [isExporting, setIsExporting] = useState(false);
  const [hasExportFailed, setHasExportFailed] = useState(false);

  async function exportConversation() {
    setIsExporting(true);
    setHasExportFailed(false);
    try {
      const response = await fetch(exportHref);
      if (!response.ok) throw new Error(`The export answered ${response.status}`);
      downloadBlob(await response.blob(), attachmentFileName(response.headers.get("Content-Disposition")));
    } catch {
      setHasExportFailed(true);
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="export-control">
      <PendingButton
        asChild
        variant="ghost"
        isPending={isExporting}
        className="export-link"
        onClick={(event) => {
          event.preventDefault();
          void exportConversation();
        }}
      >
        <a href={exportHref} download>
          {isExporting ? (
            <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
          ) : (
            <Download aria-hidden className="size-3.5" />
          )}
          {isExporting ? "Exporting…" : "Export as HTML"}
        </a>
      </PendingButton>
      {hasExportFailed && (
        <p role="alert" className="export-error">
          Couldn&rsquo;t export — try again.
        </p>
      )}
    </div>
  );
}

/** The file name a `Content-Disposition` header gives, or {@link FALLBACK_FILE_NAME} when it gives none. */
function attachmentFileName(contentDisposition: string | null): string {
  return /filename="([^"]+)"/.exec(contentDisposition ?? "")?.[1] ?? FALLBACK_FILE_NAME;
}

/** Has the browser save `blob` as `fileName`, through a temporary link to it. */
function downloadBlob(blob: Blob, fileName: string): void {
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = fileName;
  link.click();
  // After the click's task, once the browser has taken hold of the download.
  setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
}
