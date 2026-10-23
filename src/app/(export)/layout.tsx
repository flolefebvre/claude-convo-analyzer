import "@/app/globals.css";
import { fontVariableClassNames } from "@/app/_lib/fonts";

// The ROOT layout of the Conversation export (ADR-0008): the document shell, the
// app's fonts and its CSS, nothing else — no app bar, no theme script, no
// providers — so the page the download handler fetches holds only what the file keeps.
export default function ExportLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${fontVariableClassNames} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
