"use client";

// The "Active now" badge beside a Conversation's title (GLOSSARY.md, Active
// now). The server decides it shows, Live included, and hands over when it
// stops; nothing re-renders a quiet page, so the badge hides itself then.

import { useEffect, useState } from "react";

/**
 * The Active now badge, until `activeUntil` (epoch ms) on the browser's clock.
 *
 * @example {activeUntil !== null && <ActiveNowMarker activeUntil={activeUntil} />}
 */
export function ActiveNowMarker({ activeUntil }: { activeUntil: number }) {
  // The `activeUntil` that has passed, so a later change, which moves it,
  // shows the badge again.
  const [expiredActiveUntil, setExpiredActiveUntil] = useState<number | null>(null);

  useEffect(() => {
    // Hidden from the effect even when already past, so the first render
    // matches the server's HTML.
    const expiry = setTimeout(() => setExpiredActiveUntil(activeUntil), Math.max(0, activeUntil - Date.now()));
    return () => clearTimeout(expiry);
  }, [activeUntil]);

  if (expiredActiveUntil === activeUntil) return null;
  return (
    <span
      className="inline-flex shrink-0 items-center rounded bg-muted px-1 py-0.5"
      title="Active now — changed in the last 2 minutes while Live is on."
    >
      {/* The Live toggle's pulsing dot, in a muted badge's icon box. */}
      <span aria-hidden className="relative flex size-3 items-center justify-center">
        <span className="absolute inline-flex size-2 animate-ping rounded-full bg-cost opacity-75" />
        <span className="relative inline-flex size-2 rounded-full bg-cost" />
      </span>
      <span className="sr-only">Active now</span>
    </span>
  );
}
