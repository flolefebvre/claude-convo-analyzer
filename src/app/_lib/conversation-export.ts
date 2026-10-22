// The Conversation export's two pure steps (ADR-0008): turning the export
// page's HTML into one self-contained file, and naming that file. The download
// handler is a thin shell around them.

import { localDayKey } from "@/core/local-day";

/** Every `<script>` element, with its contents. */
const SCRIPT_ELEMENT = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi;

/** Every `<link>` tag. */
const LINK_TAG = /<link\b[^>]*>/gi;

/** The value of one attribute of a tag, quoted or not. */
function attributeValue(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(tag);
  return match === null ? undefined : (match[1] ?? match[2] ?? match[3]);
}

/** The stylesheet href of a `<link>` tag, or undefined when the link is anything else. */
function stylesheetHref(linkTag: string): string | undefined {
  const rel = attributeValue(linkTag, "rel")?.toLowerCase().split(/\s+/) ?? [];
  return rel.includes("stylesheet") ? attributeValue(linkTag, "href") : undefined;
}

/**
 * The page's HTML as one self-contained file: each stylesheet `<link>` becomes
 * a `<style>` holding what `readStylesheet` returns for its href, every other
 * `<link>` and every `<script>` is removed, and every other byte is kept.
 *
 * @example await selfContainedHtml(await response.text(), (href) => fetch(new URL(href, origin)).then((r) => r.text()))
 */
export async function selfContainedHtml(
  html: string,
  readStylesheet: (href: string) => Promise<string>,
): Promise<string> {
  const withoutScripts = html.replace(SCRIPT_ELEMENT, "");
  const hrefs = [...withoutScripts.matchAll(LINK_TAG)].flatMap((match) => stylesheetHref(match[0]) ?? []);
  const cssByHref = new Map(await Promise.all(hrefs.map(async (href) => [href, await readStylesheet(href)] as const)));
  return withoutScripts.replace(LINK_TAG, (linkTag) => {
    const href = stylesheetHref(linkTag);
    // A stylesheet can't end the <style> element early.
    return href === undefined ? "" : `<style>${(cssByHref.get(href) ?? "").replaceAll("</style", "<\\/style")}</style>`;
  });
}

/** The longest title slug a file name carries. */
const MAX_SLUG_LENGTH = 80;

/** A title as lowercase ASCII words joined by `-`, at most {@link MAX_SLUG_LENGTH} long; empty when none. */
function titleSlug(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, MAX_SLUG_LENGTH).replace(/-+$/, "");
}

/**
 * The export's file name: `<title-slug>-<YYYY-MM-DD>.html`, or
 * `conversation-<first 8 of the session id>-<YYYY-MM-DD>.html` for an untitled
 * Conversation (or one whose title has no ASCII letter or digit). The date is
 * the Conversation's start, in local time, and is left out (with its dash) when
 * the Conversation has no start date. ASCII only, so it needs no encoding
 * in a `Content-Disposition` header.
 *
 * @example exportFileName({ title: "Fix the login test", sessionId, startedAt }) // "fix-the-login-test-2026-10-03.html"
 */
export function exportFileName({
  title,
  sessionId,
  startedAt,
}: {
  title: string | null;
  sessionId: string;
  startedAt: string;
}): string {
  const slug = title === null ? "" : titleSlug(title);
  const name = slug === "" ? `conversation-${sessionId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 8)}` : slug;
  const startDate = new Date(startedAt);
  // A Conversation with no dated message has no start date: its name carries none.
  if (Number.isNaN(startDate.getTime())) return `${name}.html`;
  return `${name}-${localDayKey(startDate)}.html`;
}
