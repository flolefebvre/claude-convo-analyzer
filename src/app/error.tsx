"use client";

// The error page for any route below the root layout: a failed database read,
// a log the reader could not parse. Rendered under the app bar, with a retry
// that re-runs the failed segment's server render.

import { AlertTriangle } from "lucide-react";

import { EmptyState } from "@/app/_components/empty-state";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-4 py-10 sm:px-6 lg:py-16">
      <EmptyState
        icon={AlertTriangle}
        title="This page could not be loaded"
        headingLevel={1}
        className="mx-auto max-w-2xl"
        action={
          <Button variant="outline" onClick={() => retry()}>
            Try again
          </Button>
        }
      >
        Reading your conversations failed. Try again; if it keeps failing, run Refresh to rebuild the data from your
        logs.
        {error.digest && <span className="mt-2 block font-mono text-xs">Reference: {error.digest}</span>}
      </EmptyState>
    </main>
  );
}
