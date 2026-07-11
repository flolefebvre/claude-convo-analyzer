"use client";

// Sub-agents grouped by type: each group is a ranked cost bar that expands to
// reveal its individual agents. The one client leaf left in the detail panel —
// the per-group open/closed state is ephemeral local UI (not a view worth a
// URL), unlike the row's own expansion which lives in `?expanded=`. Receives
// only the plain serializable `SubAgentSection` (ADR-0002: no core import).

import { ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { CostBar } from "@/app/_components/cost-bar";
import { CostList, LABEL_W } from "@/app/_components/cost-list";
import type { SubAgentGroup, SubAgentSection } from "@/app/_lib/detail";
import { formatCost, formatTokens } from "@/app/_lib/format";
import { agentHref } from "@/app/_lib/transcript-url";

/** Owns the per-group open/closed state. `sessionId` is threaded so each
 *  individual agent row can deep-link into its own transcript. */
export function SubAgentBreakdown({
  section,
  sessionId,
}: {
  section: SubAgentSection;
  sessionId: string;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <CostList>
      {section.groups.map((g) => (
        <SubAgentGroupRow
          key={g.label}
          group={g}
          sessionId={sessionId}
          max={section.totalCost}
          open={!!open[g.label]}
          onToggle={() =>
            setOpen((prev) => ({ ...prev, [g.label]: !prev[g.label] }))
          }
        />
      ))}
    </CostList>
  );
}

function SubAgentGroupRow({
  group,
  sessionId,
  max,
  open,
  onToggle,
}: {
  group: SubAgentGroup;
  sessionId: string;
  max: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      <div className="flex items-center gap-3 text-sm">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className={`${LABEL_W} flex shrink-0 items-center gap-1.5 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50`}
        >
          {open ? (
            <ChevronDown className="size-3 shrink-0" aria-hidden />
          ) : (
            <ChevronRight className="size-3 shrink-0" aria-hidden />
          )}
          <span className="truncate hover:underline" title={group.label}>
            {group.label}
          </span>
          {group.count > 1 && (
            <span className="shrink-0 rounded bg-muted px-1 text-xs text-muted-foreground tabular-nums">
              ×{group.count}
            </span>
          )}
          <span className="sr-only">
            {open ? "Collapse" : "Expand"} {group.label} agents
          </span>
        </button>
        <CostBar value={group.costUsd} max={max} className="min-w-0 flex-1" />
        <span className="w-20 shrink-0 text-right tabular-nums text-muted-foreground">
          {formatCost(group.costUsd)}
        </span>
      </div>
      {open && group.count > 1 && (
        <ul className="mt-1.5 ml-[1.125rem] flex flex-col gap-1 border-l border-border/60 pl-3">
          {group.agents.map((a) => (
            <li key={a.agentId}>
              {/* Deep-link into this agent's transcript. `a.agentId` is the
                  `?agent=` key (`externalAgentId ?? String(id)`) the transcript
                  route resolves — a direct pass-through, no re-derivation. */}
              <Link
                href={agentHref(sessionId, a.agentId)}
                className="flex items-center justify-between gap-4 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <span className="truncate" title={a.model || undefined}>
                  {a.model || "—"}
                </span>
                <span className="flex shrink-0 gap-4 tabular-nums">
                  <span>{formatTokens(a.tokens.total)}</span>
                  <span className="w-16 text-right">
                    {formatCost(a.costUsd)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
