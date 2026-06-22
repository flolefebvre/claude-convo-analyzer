"use client";

// The Light / Dark / Auto theme control (issue #9). A three-pill segmented
// control in the page header: selecting a pill calls next-themes' `setTheme`,
// which applies the choice immediately and persists it to localStorage; the
// active pill is highlighted from the current `theme` value.
//
// next-themes' `theme` is `undefined` on the server render and the first client
// paint, so we gate the active highlight on a `mounted` flag (the standard
// next-themes pattern) to avoid a hydration-mismatched highlight. Until mounted,
// the segmented control still renders (stable markup) with no pill highlighted.
//
// ADR-0002 boundary: no core import — this is pure UI. Styling reuses existing
// design tokens (muted/background/foreground) only; no new colors (issue #9).

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

import { THEME_OPTIONS, isThemeActive } from "@/app/_lib/theme";
import { cn } from "@/lib/utils-cn";

const ICONS = {
  light: Sun,
  dark: Moon,
  system: Monitor,
} as const;

// A no-op store whose snapshot is `true` on the client and `false` on the
// server — i.e. a lint-clean "are we mounted?" flag (no setState-in-effect).
const subscribe = () => () => {};

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  // Only trust `theme` after mount; before that it is undefined on the client
  // and would mismatch the server-rendered (no-highlight) markup.
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted/50 p-0.5"
    >
      {THEME_OPTIONS.map(({ value, label }) => {
        const Icon = ICONS[value];
        const active = mounted && isThemeActive(value, theme);
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {label}
          </button>
        );
      })}
    </div>
  );
}
