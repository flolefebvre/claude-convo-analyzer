import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";

import "./globals.css";
import { AppBar } from "@/app/_components/app-bar";
import { ParserUpdateBanner } from "@/app/_components/parser-update-banner";
import { ThemeProvider } from "@/app/_components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Claude Conversation Analyzer",
    template: "%s · Claude Conversation Analyzer",
  },
  description: "Browse and cost your local Claude Code conversations.",
};

// The mobile browser chrome follows the page background (`--background` in
// each theme). It can only track the OS scheme, not an explicit in-app choice.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

// Copies the stored theme CHOICE (light / dark / system, under next-themes'
// storage key) onto <html data-theme-choice> before first paint, so the theme
// toggle shows the right option from the first frame (see theme-toggle.tsx).
// next-themes' own script only exposes the resolved theme, which cannot tell
// "dark" from "system on a dark OS".
const THEME_CHOICE_SCRIPT = `try{var c=localStorage.getItem("theme");document.documentElement.dataset.themeChoice=c==="light"||c==="dark"?c:"system"}catch(e){}`;

// The ROOT layout: the document shell — <html>/<body>, the web fonts, the theme
// provider — and the chrome every route shares: the skip link, the app bar and
// the parser-update banner under it.
// Each route renders its own <main id="main"> below the bar (the skip link's
// target), so that landmark wraps the page content only: the shell's folder
// sidebar and the transcript's agent tree sit beside it, not inside it.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      // The ThemeProvider's blocking script sets the `.dark` class on <html>
      // before hydration (no theme flash), and ours sets `data-theme-choice`;
      // suppress the resulting attribute mismatch warning.
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <script dangerouslySetInnerHTML={{ __html: THEME_CHOICE_SCRIPT }} />
        <a
          href="#main"
          className="sr-only rounded-md border bg-background text-sm font-medium shadow-md focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        {/* The theme and tooltip providers are client boundaries wrapping the
            otherwise-server tree: pages stay server components and PPR is
            unaffected. One tooltip provider, so moving between tooltips skips
            the open delay. */}
        <ThemeProvider>
          <TooltipProvider delayDuration={200}>
            <AppBar />
            {/* Absent in the normal state, so no skeleton: one would flash a
                phantom banner on every load (docs/codebase/app-router.md). */}
            <Suspense fallback={null}>
              <ParserUpdateBanner />
            </Suspense>
            {children}
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
