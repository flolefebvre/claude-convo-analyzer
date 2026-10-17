"use client";

// The search input, pre-filled from the URL on the results page. A client
// leaf: the box lives in the root layout's app bar, which cannot read
// `searchParams`.

import { X } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";

/** The search input holding `?q=` on `/search`, empty everywhere else. */
export function SearchFieldFromUrl() {
  const pathname = usePathname();
  const params = useSearchParams();
  const query = pathname === "/search" ? (params.get("q") ?? "") : "";
  return <SearchField key={query} defaultValue={query} />;
}

/**
 * The bare search input, with a clear button while it holds text (the native
 * WebKit one is hidden: it ignores the theme). Keyed by its value by the
 * caller, so a new query in the URL replaces what is typed.
 */
export function SearchField({ defaultValue }: { defaultValue?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [hasText, setHasText] = useState(Boolean(defaultValue));

  function clear() {
    if (input.current === null) return;
    input.current.value = "";
    setHasText(false);
    input.current.focus();
  }

  return (
    <>
      <input
        ref={input}
        type="search"
        name="q"
        defaultValue={defaultValue}
        onInput={(event) => setHasText(event.currentTarget.value !== "")}
        placeholder="Search conversations…"
        aria-label="Search conversations"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        className="h-8 w-full rounded-lg border border-border bg-muted/50 pr-8 pl-8 text-sm placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:appearance-none"
      />
      {hasText && (
        <button
          type="button"
          onClick={clear}
          aria-label="Clear search"
          title="Clear search"
          className="absolute right-1 grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
    </>
  );
}
