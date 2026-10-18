// The 404 page: an unknown URL, or a conversation id the logs no longer hold
// (`notFound()` in `/conversation/<id>`). Rendered under the app bar like any
// page, so search and the section tabs are right there.

import { FileQuestion } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/app/_components/empty-state";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-4 py-10 sm:px-6 lg:py-16">
      <EmptyState
        icon={FileQuestion}
        title="Page not found"
        headingLevel={1}
        className="mx-auto max-w-2xl"
        action={
          <Button asChild variant="outline">
            <Link href="/">Go to conversations</Link>
          </Button>
        }
      >
        Nothing lives at this address. If you followed a link to a conversation, its log may have been deleted; search
        for it instead.
      </EmptyState>
    </main>
  );
}
