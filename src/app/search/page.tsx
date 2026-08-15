import Link from "next/link";
import { Suspense } from "react";

import { SearchBox } from "@/app/_components/search-box";
import { ThemeToggle } from "@/app/_components/theme-toggle";
import { loadSearch } from "@/app/_lib/conversations";
import { friendlyFolderName } from "@/app/_lib/folders";
import { formatDate } from "@/app/_lib/format";
import { firstParam } from "@/app/_lib/search-params";
import { agentHref, messageHref } from "@/app/_lib/transcript-url";
import type { SearchResult, SearchSnippet } from "@/core/search";

type PageSearchParams = { q?: string | string[] };

export default function SearchPage({ searchParams }: { searchParams: Promise<PageSearchParams> }) {
  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <Suspense fallback={<SearchFallback />}>
        <SearchSurface searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function SearchSurface({ searchParams }: { searchParams: Promise<PageSearchParams> }) {
  const params = await searchParams;
  const query = (firstParam(params.q) ?? "").trim();
  const { results, hasMore } = query === "" ? { results: [], hasMore: false } : await loadSearch(query);

  return (
    <>
      <SearchHeader query={query} />
      {query === "" ? (
        <p className="text-sm text-muted-foreground">
          Search every conversation — your prompts, Claude&apos;s replies, and conversation titles.
        </p>
      ) : results.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No conversation matches <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{query}</code>.
        </p>
      ) : (
        <>
          <p className="mb-4 text-sm text-muted-foreground">
            {results.length} conversation{results.length === 1 ? "" : "s"}
            {hasMore ? ", most recent matches first" : ""}
          </p>
          <ol className="flex flex-col gap-3">
            {results.map((result) => (
              <li key={result.sessionId}>
                <ResultCard result={result} />
              </li>
            ))}
          </ol>
          {hasMore && (
            <p className="mt-5 text-sm text-muted-foreground">
              More conversations matched than are shown — add a word to refine your search.
            </p>
          )}
        </>
      )}
    </>
  );
}

function SearchHeader({ query }: { query: string }) {
  return (
    <header className="mb-6 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
          <span aria-hidden>←</span> All conversations
        </Link>
        <ThemeToggle />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
      <SearchBox defaultValue={query} className="w-full max-w-xl" />
    </header>
  );
}

function ResultCard({ result }: { result: SearchResult }) {
  const date = formatDate(result.lastMatchAt);
  return (
    <article className="rounded-lg border border-border p-4">
      <div className="flex items-baseline justify-between gap-4">
        <Link href={agentHref(result.sessionId)} className="font-medium hover:underline">
          {result.title ?? "Untitled conversation"}
        </Link>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {result.matchCount} match{result.matchCount === 1 ? "" : "es"}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
        <span title={result.project.path}>{friendlyFolderName(result.project.path)}</span>
        <span aria-hidden>·</span>
        <span className="tabular-nums" title={date.absolute}>
          {date.label}
        </span>
      </div>
      <ul className="mt-3 flex flex-col gap-1.5">
        {result.snippets.map((snippet, i) => (
          <li key={`${snippet.source}-${snippet.messageUuid ?? i}`}>
            <SnippetLink result={result} snippet={snippet} />
          </li>
        ))}
      </ul>
    </article>
  );
}

function SnippetLink({ result, snippet }: { result: SearchResult; snippet: SearchSnippet }) {
  const href =
    snippet.source === "title"
      ? agentHref(result.sessionId)
      : messageHref(result.sessionId, snippet.agentId ?? undefined, snippet.messageUuid);

  return (
    <Link
      href={href}
      className="block rounded-md border-l-2 border-border bg-muted/40 px-3 py-1.5 text-sm text-muted-foreground hover:border-cost hover:text-foreground"
    >
      {snippet.source === "title" && (
        <span className="mr-2 text-[10.5px] font-semibold tracking-[0.08em] uppercase">title</span>
      )}
      {snippet.segments.map((segment, i) =>
        segment.match ? (
          <mark key={i} className="rounded-sm bg-cost-muted px-0.5 text-foreground">
            {segment.text}
          </mark>
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
    </Link>
  );
}

function SearchFallback() {
  return (
    <>
      <SearchHeader query="" />
      <p className="text-sm text-muted-foreground">Searching…</p>
    </>
  );
}
