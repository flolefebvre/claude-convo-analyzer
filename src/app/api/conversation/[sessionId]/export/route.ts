// `GET /api/conversation/<sessionId>/export` — the Conversation export's
// download (ADR-0008). It fetches the export page from this same server, makes
// it self-contained with the home directory written `~`, and answers it as an
// attachment. A bare route handler rather than a next-pipe route: a route pipe
// always answers JSON (`docs/codebase/app-router.md`).

import os from "node:os";

import type { NextRequest } from "next/server";

import { exportFileName, selfContainedHtml, withHomeDirectoryAsTilde } from "@/app/_lib/conversation-export";
import { loadConversationDetail } from "@/app/_lib/conversations";

export async function GET(request: NextRequest, ctx: RouteContext<"/api/conversation/[sessionId]/export">) {
  const { sessionId } = await ctx.params;
  const detail = await loadConversationDetail(sessionId);
  if (detail === null) return new Response("Unknown conversation", { status: 404 });

  const pageUrl = new URL(`/conversation/${encodeURIComponent(sessionId)}/export`, request.nextUrl.origin);
  const page = await fetch(pageUrl, { cache: "no-store" });
  if (!page.ok) return new Response(`The export page answered ${page.status}`, { status: 502 });

  // Before inlining, so the embedded fonts' base64 never goes through the replacement.
  const pageHtml = withHomeDirectoryAsTilde(await page.text(), os.homedir());
  const html = await selfContainedHtml(pageHtml, pageUrl, async (url) => {
    const resource = await fetch(url, { cache: "no-store" });
    if (!resource.ok) throw new Error(`${url.pathname} answered ${resource.status}`);
    return {
      bytes: new Uint8Array(await resource.arrayBuffer()),
      contentType: resource.headers.get("content-type") ?? "application/octet-stream",
    };
  });
  const fileName = exportFileName({ title: detail.title, sessionId, startedAt: detail.startedAt });
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
