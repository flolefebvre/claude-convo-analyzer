// The theme toggle's pure data + active-state logic (issue #9). Kept out of the
// client component so it is unit-testable without a DOM/provider (the project's
// pragmatic-UI-testing posture: test the pure behavior, not the React wiring).
//
// next-themes' `theme` value is the user's CHOICE — one of the literals below —
// where "system" means "follow the OS" (Auto). `isThemeActive` decides which
// pill is highlighted from that choice.

/** The three selectable theme values, in display order (Light, Dark, Auto). */
export const THEME_OPTIONS = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Auto" },
] as const;

/** A selectable theme value: a concrete theme or "system" (Auto). */
export type ThemeOption = (typeof THEME_OPTIONS)[number]["value"];

/**
 * Whether `option` is the active choice. `theme` is next-themes' current value
 * (the user's selection), `undefined` before the provider has mounted. Returns
 * `false` for every option while unmounted so no pill is highlighted on the
 * server render / first paint (avoids a hydration-mismatched highlight).
 */
export function isThemeActive(
  option: ThemeOption,
  theme: string | undefined,
): boolean {
  return theme === option;
}
