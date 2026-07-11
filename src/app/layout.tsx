import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import "./globals.css";
import { ThemeProvider } from "@/app/_components/theme-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Claude Conversation Analyzer",
  description: "Browse and cost your local Claude Code conversations.",
};

// The ROOT layout: the global document shell only — <html>/<body>, the web
// fonts, and the theme-provider client boundary. The persistent app *chrome*
// (header + folder sidebar + overview band) lives in the `(list)` route group's
// layout, NOT here, so a full-bleed route like `/conversation/<id>` — which
// brings its OWN agent-tree sidebar — is not wrapped in the list chrome. Route
// groups (`(list)`) don't affect the URL, so the list page stays at `/`.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      // The ThemeProvider's blocking script sets the `.dark` class on <html>
      // before hydration (no theme flash); suppress the resulting class mismatch
      // warning.
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* The theme provider is a client boundary wrapping the otherwise-server
            tree: pages stay server components and PPR is unaffected. */}
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
