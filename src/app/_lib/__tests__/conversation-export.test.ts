import { describe, expect, it } from "vitest";

import { exportFileName, selfContainedHtml } from "@/app/_lib/conversation-export";

/** A stylesheet reader over a fixed set of files, recording what it was asked for. */
function stylesheets(cssByHref: Record<string, string>) {
  const requestedHrefs: string[] = [];
  const read = async (href: string) => {
    requestedHrefs.push(href);
    const css = cssByHref[href];
    if (css === undefined) throw new Error(`no stylesheet ${href}`);
    return css;
  };
  return { read, requestedHrefs };
}

describe("selfContainedHtml", () => {
  it("inlines each stylesheet link as a style element, in place", async () => {
    const { read, requestedHrefs } = stylesheets({ "/a.css": ".a{color:red}", "/b.css": ".b{}" });
    const html =
      '<head><link rel="stylesheet" href="/a.css" data-precedence="next"/><title>T</title>' +
      '<link href="/b.css" rel="stylesheet"></head>';

    expect(await selfContainedHtml(html, read)).toBe(
      "<head><style>.a{color:red}</style><title>T</title><style>.b{}</style></head>",
    );
    expect(requestedHrefs).toEqual(["/a.css", "/b.css"]);
  });

  it("removes every script, inline or external", async () => {
    const html =
      '<body><p>x</p><script src="/_next/static/chunks/main.js" async=""></script>' +
      '<script>self.__next_f.push([1,"<p>"])</script><SCRIPT type="module">\nimport \'x\'\n</SCRIPT></body>';

    expect(await selfContainedHtml(html, stylesheets({}).read)).toBe("<body><p>x</p></body>");
  });

  it("removes every link that is not a stylesheet", async () => {
    const html =
      '<head><link rel="preload" href="/f.woff2" as="font"/><link rel="modulepreload" href="/m.js">' +
      '<link rel="icon" href="/icon.svg" type="image/svg+xml" sizes="any"/><meta charset="utf-8"/></head>';

    expect(await selfContainedHtml(html, stylesheets({}).read)).toBe('<head><meta charset="utf-8"/></head>');
  });

  it("leaves everything else byte for byte", async () => {
    const html =
      '<!DOCTYPE html><html lang="en"><body class="x"><details class="call"><summary>Bash</summary>' +
      '<pre>a &lt;script&gt; in text, a link: https://example.com</pre></details>\n  <a href="#x">x</a></body></html>';

    expect(await selfContainedHtml(html, stylesheets({}).read)).toBe(html);
  });
});

describe("exportFileName", () => {
  // Noon local time, so the expected day holds in every time zone.
  const startedAt = new Date(2026, 9, 3, 12, 0).toISOString();

  it("names the file after the title's slug and the start date", () => {
    expect(exportFileName({ title: "Fix the flaky login test!", sessionId: "abc", startedAt })).toBe(
      "fix-the-flaky-login-test-2026-10-03.html",
    );
  });

  it("keeps the slug ASCII, folding accents and dropping other characters", () => {
    expect(exportFileName({ title: "Café — résumé & “notes” 日本", sessionId: "abc", startedAt })).toBe(
      "cafe-resume-notes-2026-10-03.html",
    );
  });

  it("caps a long title's slug at 80 characters, on no trailing dash", () => {
    const name = exportFileName({ title: `${"word ".repeat(40)}`, sessionId: "abc", startedAt });
    const slug = name.replace(/-2026-10-03\.html$/, "");
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug).toMatch(/^word(-word)*$/);
  });

  it("names an untitled Conversation after the first 8 characters of its session id", () => {
    expect(exportFileName({ title: null, sessionId: "0123456789abcdef", startedAt })).toBe(
      "conversation-01234567-2026-10-03.html",
    );
  });

  it("leaves the date out for a Conversation with no start date", () => {
    expect(exportFileName({ title: "Fix it", sessionId: "0123456789abcdef", startedAt: "" })).toBe("fix-it.html");
    expect(exportFileName({ title: null, sessionId: "0123456789abcdef", startedAt: "" })).toBe(
      "conversation-01234567.html",
    );
  });

  it("falls back to the session id when the title has no ASCII letter or digit", () => {
    expect(exportFileName({ title: "日本語", sessionId: "0123456789abcdef", startedAt })).toBe(
      "conversation-01234567-2026-10-03.html",
    );
  });
});
