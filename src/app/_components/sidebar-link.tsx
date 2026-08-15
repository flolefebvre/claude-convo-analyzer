"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils-cn";

export function SidebarLink({
  folder,
  title,
  children,
}: {
  folder: string | null;
  title?: string;
  children: React.ReactNode;
}) {
  const params = useSearchParams();
  const rawFolder = params.get("folder");
  const activeFolder = rawFolder ? rawFolder : undefined;
  const active = activeFolder === (folder ?? undefined);
  const next = new URLSearchParams(params.toString());
  if (folder) {
    next.set("folder", folder);
  } else {
    next.delete("folder");
  }
  next.delete("expanded");
  const href = `?${next.toString()}`;
  return (
    <Link
      href={href}
      title={title}
      aria-current={active ? "true" : undefined}
      className={cn(
        "relative block rounded-md px-3 py-2 text-sm transition-colors",
        active
          ? "bg-cost-muted text-foreground before:absolute before:top-1/2 before:left-0 before:h-7 before:w-[3px] before:-translate-y-1/2 before:rounded-r before:bg-cost"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}
