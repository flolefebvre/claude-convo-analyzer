// Search results — `/search?q=…` (issue #45). A React Server Component: it
// reads the query from `searchParams`, runs the core full-text search through
// the cached app-zone reader, and renders one card per matching conversation.
//
// ORDERED BY RECENCY, not relevance: you half-remember *when* a conversation
// happened, so the newest last match leads. Relevance only picks which extracts
// a card shows. Search is always GLOBAL — a `?folder=` scope in effect elsewhere
// never narrows it; each card names its Project instead.
//
// This route sits OUTSIDE the `(shell)` route group: the results page needs no
// folder sidebar. Its search box is the app bar's, which holds the query.
//
// ADR-0002 boundary: the core read is reached through `loadSearch` (app-zone),
// never a direct core import; only the result TYPES come from core, and types
// are erased at compile time.
//
// `cacheComponents` (PPR) is on, so the request-time `searchParams` read is
// wrapped in <Suspense>: the page shell prerenders, the results stream in.

import { Search, SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { EmptyState, EmptyStateLink } from "@/app/_components/empty-state";
import { LoadingRegion } from "@/app/_components/loading-region";
import { PageHeader } from "@/app/_components/page-header";
import { loadSearch } from "@/app/_lib/conversations";
import { friendlyFolderName } from "@/app/_lib/folders";
import { formatCount, formatDate } from "@/app/_lib/format";
import { firstParam } from "@/app/_lib/search-params";
import { agentHref, messageHref } from "@/app/_lib/transcript-url";
import type { SearchResult, SearchSnippet } from "@/core/search";
import { Skeleton } from "@/components/ui/skeleton";

type PageSearchParams = { q?: string | string[] };

/** The tab names the query, so search tabs and history entries tell apart. */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}): Promise<Metadata> {
  const query = (firstParam((await searchParams).q) ?? "").trim();
  return { title: query === "" ? "Search" : `Search: ${query}` };
}

export default function SearchPage({ searchParams }: { searchParams: Promise<PageSearchParams> }) {
  return (
    <main id="main" tabIndex={-1} className="mx-auto w-full max-w-frame px-4 py-6 sm:px-6 lg:py-8">
      <div className="flex max-w-3xl flex-col gap-5">
        <PageHeader title="Search" description="Your prompts, Claude's replies and conversation titles." />
        <Suspense fallback={<SearchFallback />}>
          <SearchSurface searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

/** The result cards its skeleton draws: enough to fill the first screen. */
const SKELETON_RESULTS = 4;

/**
 * The results' skeleton: the count line, then a few cards at a result card's
 * size (title and match count, Project and date, one or two extracts).
 */
function SearchFallback() {
  return (
    <LoadingRegion label="Loading results">
      <div className="mb-4 flex h-5 items-center">
        <Skeleton className="h-3.5 w-56" />
      </div>
      <div className="flex flex-col gap-3">
        {Array.from({ length: SKELETON_RESULTS }, (_, index) => (
          <div key={index} className="rounded-xl border bg-card p-4">
            <div className="flex h-6 items-center justify-between gap-4">
              <Skeleton className="h-4 w-72 max-w-[70%]" />
              <Skeleton className="h-3 w-16" />
            </div>
            <div className="mt-1 flex h-4 items-center">
              <Skeleton className="h-3 w-40" />
            </div>
            <div className="mt-3 flex flex-col gap-1.5">
              {Array.from({ length: (index % 2) + 1 }, (_, extract) => (
                <Skeleton key={extract} className="h-8 w-full" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </LoadingRegion>
  );
}

/**
 * Awaits the query and its results, then renders them. Split out from
 * {@link SearchPage} so the request-time read sits inside the page's <Suspense>
 * boundary (PPR).
 */
async function SearchSurface({ searchParams }: { searchParams: Promise<PageSearchParams> }) {
  const params = await searchParams;
  const query = (firstParam(params.q) ?? "").trim();
  // An empty box is not a search: prompt for one, and never touch the database.
  if (query === "") {
    return (
      <EmptyState icon={Search} title="Search your conversations">
        Type a word or phrase in the search box at the top of the page.
      </EmptyState>
    );
  }

  const { results, hasMore } = await loadSearch(query);
  if (results.length === 0) {
    return (
      <EmptyState
        icon={SearchX}
        title={`No conversation matches “${query}”`}
        action={<EmptyStateLink href="/search">Clear search</EmptyStateLink>}
      >
        Check the spelling, or try fewer words.
      </EmptyState>
    );
  }

  const count = `${results.length} conversation${results.length === 1 ? "" : "s"}`;
  return (
    <div>
      {/* Said up front when the list is capped, not only after the last card. */}
      <p className="mb-4 text-sm text-muted-foreground">
        {hasMore
          ? `Showing the ${count} with the most recent matches. More matched: add a word to narrow the search.`
          : `${count}, most recent matches first`}
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
          Only the {results.length} most recent are shown. Add a word to narrow the search.
        </p>
      )}
    </div>
  );
}

/**
 * One matching conversation: what it was, where, when, and what matched. A
 * title match is highlighted in the heading itself rather than repeated as an
 * extract, and the matches without an extract are counted under the list.
 */
function ResultCard({ result }: { result: SearchResult }) {
  const date = formatDate(result.lastMatchAt);
  const titleSnippet = result.snippets.find((snippet) => snippet.source === "title");
  const extracts = result.snippets.filter((snippet) => snippet.source !== "title");
  const unshown = result.matchCount - result.snippets.length;
  return (
    <article className="rounded-xl border bg-card p-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="min-w-0 text-base font-medium">
          <Link href={agentHref(result.sessionId)} className="hover:underline">
            {titleSnippet ? (
              <Highlighted segments={titleSnippet.segments} />
            ) : (
              (result.title ?? "Untitled conversation")
            )}
          </Link>
        </h2>
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatCount(result.matchCount)} match{result.matchCount === 1 ? "" : "es"}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
        <span title={result.project.path}>{friendlyFolderName(result.project.path)}</span>
        <span aria-hidden>·</span>
        <span title={date.absolute}>{date.label}</span>
      </div>
      {extracts.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {extracts.map((snippet, i) => (
            <li key={`${snippet.source}-${snippet.messageUuid ?? i}`}>
              <SnippetLink result={result} snippet={snippet} />
            </li>
          ))}
        </ul>
      )}
      {unshown > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          <Link href={agentHref(result.sessionId)} className="underline-offset-2 hover:text-foreground hover:underline">
            +{formatCount(unshown)} more match{unshown === 1 ? "" : "es"} in this conversation
          </Link>
        </p>
      )}
    </article>
  );
}

/**
 * One extract, linking into the Transcript at the exact message that matched —
 * conversation AND agent AND message (`?agent=…&msg=…#msg-…`). Hovering it
 * previews the transcript's "you are here" mark: the clay tint and bar the
 * message wears when the link lands.
 */
function SnippetLink({ result, snippet }: { result: SearchResult; snippet: SearchSnippet }) {
  return (
    <Link
      href={messageHref(result.sessionId, snippet.agentId ?? undefined, snippet.messageUuid)}
      className="block rounded-r-md bg-muted/40 py-1.5 pr-3 pl-3.5 text-sm text-muted-foreground shadow-[inset_2px_0_0_var(--border)] transition-colors hover:bg-cost-muted hover:text-foreground hover:shadow-[inset_3px_0_0_var(--cost)]"
    >
      <Highlighted segments={snippet.segments} />
    </Link>
  );
}

/**
 * Matched runs in a clay `<mark>`. Segments arrive from the core reader already
 * split into plain and matched runs — highlighting never round-trips through
 * raw HTML.
 */
function Highlighted({ segments }: { segments: SearchSnippet["segments"] }) {
  return segments.map((segment, i) =>
    segment.match ? (
      <mark
        key={i}
        className="rounded-[3px] bg-cost/25 box-decoration-clone px-0.5 font-medium text-foreground dark:bg-cost/35"
      >
        {segment.text}
      </mark>
    ) : (
      <span key={i}>{segment.text}</span>
    ),
  );
}
