// Reading Next's `searchParams` — the one canonical helper.
//
// Next hands every search param as `string | string[] | undefined` (a param can
// repeat in a URL), while every page and view-state resolver here wants a single
// value. This module is where that collapse lives, once, for every route.
//
// React-free + I/O-free so it unit-tests in the node vitest environment.

/**
 * The view-state axes the app carries in the URL, as Next hands them over —
 * every page that reads view state takes `Promise<ViewSearchParams>`. A surface
 * simply ignores the axes it has no say over; the values still travel with it,
 * so switching surfaces never drops the scope or range the user picked.
 *
 * @example async function Page({ searchParams }: { searchParams: Promise<ViewSearchParams> })
 */
export type ViewSearchParams = {
  sortBy?: string | string[];
  dir?: string | string[];
  folder?: string | string[];
  expanded?: string | string[];
  range?: string | string[];
  errors?: string | string[];
  page?: string | string[];
};

/**
 * First value of a `searchParams` entry.
 *
 * A repeated param (`?q=a&q=b`) yields the FIRST value, so a hand-edited or
 * duplicated URL is read deterministically instead of erroring.
 */
export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
