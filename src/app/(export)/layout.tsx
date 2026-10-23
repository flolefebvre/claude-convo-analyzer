import "@/app/globals.css";
import { fontVariableClassNames } from "@/app/_lib/fonts";

// The ROOT layout of the Conversation export (ADR-0008): the document shell, the
// app's fonts and its CSS, nothing else — no app bar, no theme script, no
// providers — so the page the download handler fetches holds only what the file keeps.
// With no theme script, its dark theme comes from the OS color scheme (globals.css).
export default function ExportLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${fontVariableClassNames} follows-os-color-scheme h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
