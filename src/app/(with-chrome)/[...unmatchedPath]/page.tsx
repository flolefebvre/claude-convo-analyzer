// Every URL no other route matches. There is no top-level root layout to render
// an unmatched URL under, so this page sends it to the group's not-found page,
// under the app bar like any page.

import { notFound } from "next/navigation";

// Nothing to validate: the page never renders, it always throws `notFound()`.
export const instant = false;

export default function UnmatchedPathPage() {
  notFound();
}
