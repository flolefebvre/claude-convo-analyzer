import Form from "next/form";
import { Search } from "lucide-react";
import { Suspense } from "react";

import { SearchField, SearchFieldFromUrl } from "@/app/_components/search-field";
import { cn } from "@/lib/utils-cn";

/**
 * The full-text search box (issue #45), in the app bar on every route, so "find
 * that conversation where we discussed X" is one keystroke away wherever you
 * are. On the results page it holds the query you just ran, so a refinement
 * starts from it.
 *
 * A `next/form` GET form pointed at `/search`: submitting puts the query in the
 * URL (`/search?q=…`) and navigates client-side, and it still works with
 * JavaScript off — the URL IS the state, exactly like the list's sort/scope
 * links. This stays a server component; `<Form>` and the URL-reading input
 * bring their own client boundaries.
 *
 * ADR-0002: pure UI, no core import.
 *
 * @example <SearchBox className="w-full md:w-60" />
 */
export function SearchBox({ className }: { className?: string }) {
  return (
    <Form action="/search" role="search" className={cn("relative flex items-center", className)}>
      <Search className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground" aria-hidden />
      {/* The pre-filled value comes from the live URL, which only the client
          reads; the prerendered shell shows the same field, empty. */}
      <Suspense fallback={<SearchField />}>
        <SearchFieldFromUrl />
      </Suspense>
    </Form>
  );
}
