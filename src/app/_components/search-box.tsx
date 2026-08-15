import Form from "next/form";
import { Search } from "lucide-react";

export function SearchBox({ defaultValue, className }: { defaultValue?: string; className?: string }) {
  return (
    <Form action="/search" role="search" className={`relative flex items-center ${className ?? "w-56"}`}>
      <Search className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground" aria-hidden />
      <input
        type="search"
        name="q"
        defaultValue={defaultValue}
        placeholder="Search conversations…"
        aria-label="Search conversations"
        className="h-8 w-full rounded-lg border border-border bg-muted/50 pr-2.5 pl-8 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      />
    </Form>
  );
}
