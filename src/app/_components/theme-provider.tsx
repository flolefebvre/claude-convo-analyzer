"use client";

// The app-wide theme provider (issue #9). A thin "use client" boundary around
// next-themes' provider so the server `layout.tsx` can wrap `{children}` without
// itself becoming a client component — the page/table stay server components and
// PPR is unaffected (ADR-0004 sanctions this single client-JS exception).
//
// Config per issue #9: `attribute="class"` toggles a `.dark` class on <html>,
// which lines up with globals.css's `@custom-variant dark` + `.dark` tokens;
// `defaultTheme="system"` + `enableSystem` make first load follow the OS. The
// provider also injects the blocking inline script that sets the class before
// hydration, so there is no flash of the wrong theme.

import { ThemeProvider as NextThemesProvider } from "next-themes";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem>
      {children}
    </NextThemesProvider>
  );
}
