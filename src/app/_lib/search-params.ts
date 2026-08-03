// Reading Next's `searchParams` — the one canonical helper.
//
// Next hands every search param as `string | string[] | undefined` (a param can
// repeat in a URL), while every page here wants a single value. That collapse
// was being re-written locally in each route (issue #49 counts seven copies);
// this module is the version those call sites migrate to, so the rule lives in
// one place with one test.
//
// React-free + I/O-free so it unit-tests in the node vitest environment.

/**
 * First value of a `searchParams` entry.
 *
 * A repeated param (`?q=a&q=b`) yields the FIRST value — the same rule the
 * route-level view-state resolvers already applied, so a hand-edited or
 * duplicated URL is read deterministically instead of erroring.
 */
export function firstParam(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
