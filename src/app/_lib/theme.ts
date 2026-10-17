// The theme toggle's pure data, checked-state and keyboard logic (issue #9). Kept out of the
// client component so it is unit-testable without a DOM/provider (the project's
// pragmatic-UI-testing posture: test the pure behavior, not the React wiring).
//
// next-themes' `theme` value is the user's CHOICE — one of the literals below —
// where "system" means "follow the OS". `isThemeActive` decides which
// option is checked from that choice.

/** The three selectable theme values, in display order (Light, Dark, System). */
export const THEME_OPTIONS = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
] as const;

/** A selectable theme value: a concrete theme or "system" (follow the OS). */
export type ThemeOption = (typeof THEME_OPTIONS)[number]["value"];

/**
 * Whether `option` is the active choice. `theme` is next-themes' current value
 * (the user's selection), `undefined` before the provider has mounted. Returns
 * `false` for every option while unmounted, so the server render and the first
 * client render agree on `aria-checked`.
 */
export function isThemeActive(option: ThemeOption, theme: string | undefined): boolean {
  return theme === option;
}

/**
 * The option a radiogroup key press moves to, following the ARIA radio
 * pattern: arrows step and wrap, Home/End jump to the ends. `null` for any
 * other key, so the caller lets it through.
 *
 * @example stepThemeOption("system", "ArrowRight") // "light"
 */
export function stepThemeOption(current: ThemeOption, key: string): ThemeOption | null {
  const values = THEME_OPTIONS.map((option) => option.value);
  const index = values.indexOf(current);
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return values[(index + 1) % values.length];
    case "ArrowLeft":
    case "ArrowUp":
      return values[(index - 1 + values.length) % values.length];
    case "Home":
      return values[0];
    case "End":
      return values[values.length - 1];
    default:
      return null;
  }
}
