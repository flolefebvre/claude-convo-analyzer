import { describe, expect, it } from "vitest";

import { exportFileName, selfContainedHtml, withHomeDirectoryAsTilde } from "@/app/_lib/conversation-export";

/** The URL the export page is fetched from, which every relative href resolves against. */
const PAGE_URL = new URL("http://app.test/conversation/abc/export");

/** A resource reader over a fixed set of files by absolute URL, recording what it was asked for. */
function resources(resourceByUrl: Record<string, { body: string | Uint8Array; contentType: string }>) {
  const requestedUrls: string[] = [];
  const read = async (url: URL) => {
    requestedUrls.push(url.href);
    const resource = resourceByUrl[url.href];
    if (resource === undefined) throw new Error(`no resource ${url.href}`);
    const bytes = typeof resource.body === "string" ? new TextEncoder().encode(resource.body) : resource.body;
    return { bytes, contentType: resource.contentType };
  };
  return { read, requestedUrls };
}

/** A stylesheet resource. */
function css(body: string) {
  return { body, contentType: "text/css; charset=utf-8" };
}

describe("selfContainedHtml", () => {
  it("inlines each stylesheet link as a style element, in place", async () => {
    const { read, requestedUrls } = resources({
      "http://app.test/a.css": css(".a{color:red}"),
      "http://app.test/conversation/abc/b.css": css(".b{}"),
    });
    const html =
      '<head><link rel="stylesheet" href="/a.css" data-precedence="next"/><title>T</title>' +
      '<link href="b.css" rel="stylesheet"></head>';

    expect(await selfContainedHtml(html, PAGE_URL, read)).toBe(
      "<head><style>.a{color:red}</style><title>T</title><style>.b{}</style></head>",
    );
    expect(requestedUrls).toEqual(["http://app.test/a.css", "http://app.test/conversation/abc/b.css"]);
  });

  it("embeds each file a stylesheet references as a data URL, resolved against the stylesheet", async () => {
    const font = new Uint8Array([0, 1, 2, 250, 251, 252]);
    const { read, requestedUrls } = resources({
      "http://app.test/_next/static/chunks/app.css": css(
        '@font-face{src:url("../media/geist.woff2")format("woff2")}' +
          ".a{background:url(../media/geist.woff2)}.b{mask:url( '/icon.svg' )}",
      ),
      "http://app.test/_next/static/media/geist.woff2": { body: font, contentType: "font/woff2" },
      "http://app.test/icon.svg": { body: "<svg/>", contentType: "image/svg+xml; charset=utf-8" },
    });
    const html = '<link rel="stylesheet" href="/_next/static/chunks/app.css">';

    const fontUrl = `data:font/woff2;base64,${Buffer.from(font).toString("base64")}`;
    const iconUrl = `data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}`;
    expect(await selfContainedHtml(html, PAGE_URL, read)).toBe(
      `<style>@font-face{src:url("${fontUrl}")format("woff2")}` +
        `.a{background:url(${fontUrl})}.b{mask:url( '${iconUrl}' )}</style>`,
    );
    // A file referenced twice is read once.
    expect(requestedUrls.filter((url) => url.endsWith("geist.woff2"))).toHaveLength(1);
  });

  it("leaves a url() that is already a data URL or a fragment alone", async () => {
    const stylesheet = '.a{background:url("data:image/png;base64,AAAA")}.b{filter:url(#blur)}';
    const { read, requestedUrls } = resources({ "http://app.test/a.css": css(stylesheet) });

    expect(await selfContainedHtml('<link rel="stylesheet" href="/a.css">', PAGE_URL, read)).toBe(
      `<style>${stylesheet}</style>`,
    );
    expect(requestedUrls).toEqual(["http://app.test/a.css"]);
  });

  it("strips the stylesheet's source map comment", async () => {
    const { read } = resources({
      "http://app.test/a.css": css(".a{color:red}\n/*# sourceMappingURL=a.css.map*/\n"),
    });

    expect(await selfContainedHtml('<link rel="stylesheet" href="/a.css">', PAGE_URL, read)).toBe(
      "<style>.a{color:red}\n\n</style>",
    );
  });

  it("removes every script, inline or external", async () => {
    const html =
      '<body><p>x</p><script src="/_next/static/chunks/main.js" async=""></script>' +
      '<script>self.__next_f.push([1,"<p>"])</script><SCRIPT type="module">\nimport \'x\'\n</SCRIPT></body>';

    expect(await selfContainedHtml(html, PAGE_URL, resources({}).read)).toBe("<body><p>x</p></body>");
  });

  it("removes every link that is not a stylesheet", async () => {
    const html =
      '<head><link rel="preload" href="/f.woff2" as="font"/><link rel="modulepreload" href="/m.js">' +
      '<link rel="icon" href="/icon.svg" type="image/svg+xml" sizes="any"/><meta charset="utf-8"/></head>';

    expect(await selfContainedHtml(html, PAGE_URL, resources({}).read)).toBe('<head><meta charset="utf-8"/></head>');
  });

  it("leaves everything else byte for byte", async () => {
    const html =
      '<!DOCTYPE html><html lang="en"><body class="x"><details class="call"><summary>Bash</summary>' +
      "<pre>a &lt;script&gt; in text, a link: https://example.com, url(/x.png)</pre></details>\n" +
      '  <a href="#x">x</a></body></html>';

    expect(await selfContainedHtml(html, PAGE_URL, resources({}).read)).toBe(html);
  });
});

describe("withHomeDirectoryAsTilde", () => {
  it("writes a POSIX home directory as ~ in text, attributes and JSON alike", () => {
    const html =
      '<dd>/home/ann/dev/api</dd><p title="/home/ann">cd /home/ann</p>' +
      '<pre>{"file_path":"/home/ann/dev/api/src/x.ts"}</pre>';

    expect(withHomeDirectoryAsTilde(html, "/home/ann")).toBe(
      '<dd>~/dev/api</dd><p title="~">cd ~</p><pre>{"file_path":"~/dev/api/src/x.ts"}</pre>',
    );
  });

  it("writes a Windows home directory as ~, literal or JSON-escaped", () => {
    const html = String.raw`<dd>C:\Users\ann\dev\api</dd><pre>{"file_path":"C:\\Users\\ann\\dev\\api\\x.ts"}</pre>`;

    expect(withHomeDirectoryAsTilde(html, String.raw`C:\Users\ann`)).toBe(
      String.raw`<dd>~\dev\api</dd><pre>{"file_path":"~\\dev\\api\\x.ts"}</pre>`,
    );
  });

  it("leaves a longer name that starts with the home directory's alone", () => {
    expect(withHomeDirectoryAsTilde("/home/anna/x /home/ann_b /home/ann-c", "/home/ann")).toBe(
      "/home/anna/x /home/ann_b /home/ann-c",
    );
    expect(withHomeDirectoryAsTilde(String.raw`C:\Users\anna\x`, String.raw`C:\Users\ann`)).toBe(
      String.raw`C:\Users\anna\x`,
    );
  });

  it("treats a dot as the end of the home directory only when no name continues after it", () => {
    expect(withHomeDirectoryAsTilde("It lives in /home/ann. Then /home/ann.bak", "/home/ann")).toBe(
      "It lives in ~. Then /home/ann.bak",
    );
  });

  it("leaves the HTML alone when the home directory is a filesystem root", () => {
    expect(withHomeDirectoryAsTilde("<p>/ a/b</p>", "/")).toBe("<p>/ a/b</p>");
    expect(withHomeDirectoryAsTilde("<p>C:\\ x</p>", "C:\\")).toBe("<p>C:\\ x</p>");
  });

  it("matches the home directory exactly, as a literal", () => {
    expect(withHomeDirectoryAsTilde("/home/a.n/x /home/axn/x", "/home/a.n")).toBe("~/x /home/axn/x");
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
