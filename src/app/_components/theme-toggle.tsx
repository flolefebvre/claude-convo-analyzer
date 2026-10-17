"use client";

// The Light / Dark / System theme control (issue #9): an icon-only segmented
// radiogroup in the app bar. Selecting an option calls next-themes' `setTheme`,
// which applies the choice immediately and persists it to localStorage.
//
// Keyboard: one Tab stop (the checked option); the arrows move and select, Home
// and End jump to the ends — the ARIA radio pattern.
//
// The highlight is painted by CSS from `<html data-theme-choice>` (globals.css),
// not from React state: next-themes' `theme` is unknown until the client
// mounts, but the root layout's inline script sets the attribute from
// localStorage before first paint, so the checked option is right from the first
// frame. This component keeps the attribute in sync once mounted. `aria-checked`
// and the roving tab stop still come from `theme` after mount.
//
// ADR-0002 boundary: no core import — this is pure UI.

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useRef, useSyncExternalStore } from "react";

import { THEME_OPTIONS, type ThemeOption, isThemeActive, stepThemeOption } from "@/app/_lib/theme";

const ICONS = {
  light: Sun,
  dark: Moon,
  system: Monitor,
} as const;

// A no-op store whose snapshot is `true` on the client and `false` on the
// server — i.e. a lint-clean "are we mounted?" flag (no setState-in-effect).
const subscribe = () => () => {};

function isThemeOption(value: string | undefined): value is ThemeOption {
  return THEME_OPTIONS.some((option) => option.value === value);
}

/**
 * The app bar's theme switcher: three 32px icon radios (Light, Dark, System).
 *
 * @example <ThemeToggle />
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const buttons = useRef(new Map<ThemeOption, HTMLButtonElement>());

  // Only trust `theme` after mount; before that it is undefined on the client
  // and would mismatch the server-rendered markup.
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const current: ThemeOption = mounted && isThemeOption(theme) ? theme : "system";

  // Mirror the choice onto <html> for the CSS highlight (also catches a change
  // made in another tab, which next-themes syncs into `theme`).
  useEffect(() => {
    if (isThemeOption(theme)) document.documentElement.dataset.themeChoice = theme;
  }, [theme]);

  function handleKeyDown(event: React.KeyboardEvent) {
    const next = stepThemeOption(current, event.key);
    if (next === null) return;
    event.preventDefault();
    setTheme(next);
    buttons.current.get(next)?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      onKeyDown={handleKeyDown}
      className="inline-flex h-8 shrink-0 items-center rounded-lg bg-muted/60 ring-1 ring-border ring-inset"
    >
      {THEME_OPTIONS.map(({ value, label }) => {
        const Icon = ICONS[value];
        return (
          <button
            key={value}
            ref={(node) => {
              if (node) buttons.current.set(value, node);
              else buttons.current.delete(value);
            }}
            type="button"
            role="radio"
            aria-checked={mounted && isThemeActive(value, theme)}
            aria-label={label}
            title={label}
            tabIndex={value === current ? 0 : -1}
            data-theme-option={value}
            onClick={() => setTheme(value)}
            className="theme-option inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground"
          >
            <Icon className="size-4" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
