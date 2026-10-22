// `GET /api/conversation/<sessionId>/export` — the Conversation export's
// download (ADR-0008). It fetches the export page from this same server, makes
// it self-contained and answers it as an attachment. A bare route handler
// rather than a next-pipe route: a route pipe always answers JSON
// (`docs/codebase/app-router.md`).

import type { NextRequest } from "next/server";

import { exportFileName, selfContainedHtml } from "@/app/_lib/conversation-export";
import { loadConversationDetail } from "@/app/_lib/conversations";

export async function GET(request: NextRequest, ctx: RouteContext<"/api/conversation/[sessionId]/export">) {
  const { sessionId } = await ctx.params;
  const detail = await loadConversationDetail(sessionId);
  if (detail === null) return new Response("Unknown conversation", { status: 404 });

  const origin = request.nextUrl.origin;
  const page = await fetch(`${origin}/conversation/${encodeURIComponent(sessionId)}/export`, { cache: "no-store" });
  if (!page.ok) return new Response(`The export page answered ${page.status}`, { status: 502 });

  const html = await selfContainedHtml(await page.text(), async (href) => {
    const stylesheet = await fetch(new URL(href, origin), { cache: "no-store" });
    if (!stylesheet.ok) throw new Error(`Stylesheet ${href} answered ${stylesheet.status}`);
    return stylesheet.text();
  });
  const fileName = exportFileName({ title: detail.title, sessionId, startedAt: detail.startedAt });
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
