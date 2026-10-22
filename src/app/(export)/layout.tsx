import type { CSSProperties } from "react";

import "@/app/globals.css";

// The ROOT layout of the Conversation export (ADR-0008): the document shell and
// the app's CSS, nothing else — no app bar, no theme script, no providers — so
// the page the download handler fetches holds only what the file keeps.
export default function ExportLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
      // No next/font here: these stand in for its variables so the font stacks resolve to system fonts.
      // #247 replaces them with the embedded fonts.
      style={{ "--font-geist-sans": "ui-sans-serif", "--font-geist-mono": "ui-monospace" } as CSSProperties}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
