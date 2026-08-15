import { ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";

export function ExpandToggle({
  href,
  expanded,
  label,
  children,
}: {
  href: string;
  expanded: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-expanded={expanded}
      className="inline-flex items-center gap-1.5 rounded-sm text-left outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      {expanded ? (
        <ChevronDown className="size-3.5 shrink-0" aria-hidden />
      ) : (
        <ChevronRight className="size-3.5 shrink-0" aria-hidden />
      )}
      <span className="sr-only">
        {expanded ? "Collapse" : "Expand"} {label}
      </span>
      {children}
    </Link>
  );
}
