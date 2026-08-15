export const THEME_OPTIONS = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Auto" },
] as const;

export type ThemeOption = (typeof THEME_OPTIONS)[number]["value"];

export function isThemeActive(option: ThemeOption, theme: string | undefined): boolean {
  return theme === option;
}
