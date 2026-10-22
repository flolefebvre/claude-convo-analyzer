// Every URL no other route matches. There is no top-level root layout to render
// an unmatched URL under, so this page sends it to the group's not-found page,
// under the app bar like any page.
//
// Under `next dev` this 404 comes back as Next's bare error shell
// (`<html id="__next_error__">`), which the client then renders: the page looks
// the same, but the tab keeps the default title and the dev overlay reports the
// layout's theme <script>. Dev builds a 404 thrown outside any <Suspense> from
// the top-level layout, which this app deliberately has none of; the production
// build prerenders this page, 404 status and "Not found" title included.
// Throwing inside a <Suspense> instead fixes nothing: the title then streams in
// late in production, and dev answers 200 and never shows it.

import { notFound } from "next/navigation";

// Nothing to validate: the page never renders, it always throws `notFound()`.
export const instant = false;

export default function UnmatchedPathPage() {
  notFound();
}
