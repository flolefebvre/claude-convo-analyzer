"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

/** How long a copy button shows "Copied". */
const COPIED_MS = 1500;

/**
 * A small button putting `text` on the clipboard, then reading "Copied" for a
 * moment. `text` may be a function, called only on the click: for a text
 * costly to build, such as a large body's JSON.
 *
 * @example <CopyButton text={() => JSON.stringify(value, null, 2)} label="Copy JSON" />
 */
export function CopyButton({
  text,
  label = "Copy",
  className,
}: {
  text: string | (() => string);
  label?: string;
  className?: string;
}) {
  const [isCopied, setIsCopied] = useState(false);
  useEffect(() => {
    if (!isCopied) return;
    const timer = setTimeout(() => setIsCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [isCopied]);

  return (
    <Button
      size="sm"
      variant="ghost"
      className={className}
      onClick={() =>
        void navigator.clipboard.writeText(typeof text === "function" ? text() : text).then(() => setIsCopied(true))
      }
    >
      {isCopied ? <Check aria-hidden /> : <Copy aria-hidden />}
      {isCopied ? "Copied" : label}
    </Button>
  );
}
