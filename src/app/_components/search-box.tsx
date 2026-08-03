import Form from "next/form";
import { Search } from "lucide-react";

/**
 * The full-text search box (issue #45) — in every surface's header, so "find
 * that conversation where we discussed X" is one keystroke away wherever you
 * are: the app shell, the transcript view, and the results page itself.
 *
 * A `next/form` GET form pointed at `/search`: submitting puts the query in the
 * URL (`/search?q=…`) and navigates client-side, and it still works with
 * JavaScript off — the URL IS the state, exactly like the list's sort/scope
 * links. This stays a server component; `<Form>` brings its own client
 * boundary.
 *
 * ADR-0002: pure UI, no core import. Styling uses existing semantic tokens
 * only, so both themes read correctly with no per-theme rule.
 */
export function SearchBox({
  /** Pre-fills the input on the results page, so a refinement starts from the
   *  query you just ran. */
  defaultValue,
  /** Tailwind width utility for the surface this sits in (headers are tight,
   *  the results page is roomy). */
  className,
}: {
  defaultValue?: string;
  className?: string;
}) {
  return (
    <Form
      action="/search"
      role="search"
      className={`relative flex items-center ${className ?? "w-56"}`}
    >
      <Search
        className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground"
        aria-hidden
      />
      <input
        type="search"
        name="q"
        defaultValue={defaultValue}
        placeholder="Search conversations…"
        aria-label="Search conversations"
        className="h-8 w-full rounded-lg border border-border bg-muted/50 pl-8 pr-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      />
    </Form>
  );
}
