"use client";

// Sub-agents grouped by type: each group is a ranked cost bar that expands to
// reveal its individual agents (a group of one links straight to its agent). The one client leaf left in the detail panel —
// the per-group open/closed state is ephemeral local UI (not a view worth a
// URL), unlike the row's own expansion which lives in `?expanded=`. Receives
// only the plain serializable `SubAgentSection` (ADR-0002: no core import).

import { ArrowUpRight, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { CostBar } from "@/app/_components/cost-bar";
import { CostList, LABEL_W } from "@/app/_components/cost-list";
import type { SubAgentGroup, SubAgentSection } from "@/app/_lib/detail";
import { formatCost, formatTokens } from "@/app/_lib/format";
import { agentHref, withListReturn } from "@/app/_lib/transcript-url";

/** Owns the per-group open/closed state. `sessionId` is threaded so each
 *  individual agent row can deep-link into its own transcript, carrying the
 *  list view (`listReturn`) its back link restores. */
export function SubAgentBreakdown({
  section,
  sessionId,
  listReturn,
}: {
  section: SubAgentSection;
  sessionId: string;
  listReturn?: string;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <CostList>
      {section.groups.map((g) => (
        <SubAgentGroupRow
          key={g.label}
          group={g}
          sessionId={sessionId}
          listReturn={listReturn}
          max={section.totalCost}
          open={!!open[g.label]}
          onToggle={() => setOpen((prev) => ({ ...prev, [g.label]: !prev[g.label] }))}
        />
      ))}
    </CostList>
  );
}

function SubAgentGroupRow({
  group,
  sessionId,
  listReturn,
  max,
  open,
  onToggle,
}: {
  group: SubAgentGroup;
  sessionId: string;
  listReturn?: string;
  max: number;
  open: boolean;
  onToggle: () => void;
}) {
  // A group of one has nothing to unfold: its label links straight to that
  // agent's transcript, behind a spacer the width of the chevron so every
  // label starts at the same x.
  const only = group.count === 1 ? group.agents[0] : undefined;
  return (
    <li>
      <div className="flex items-center gap-3 text-sm">
        {only ? (
          <Link
            href={withListReturn(agentHref(sessionId, only.agentId), listReturn)}
            className={`${LABEL_W} group/one flex min-h-6 shrink-0 items-center gap-1.5 rounded-sm`}
            title={only.model ? `${group.label} · ${only.model}` : group.label}
          >
            <span aria-hidden className="size-3 shrink-0" />
            <span className="truncate group-hover/one:underline">{group.label}</span>
            <ArrowUpRight
              className="size-3 shrink-0 opacity-0 transition-opacity group-hover/one:opacity-60"
              aria-hidden
            />
            <span className="sr-only">: open transcript</span>
          </Link>
        ) : (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className={`${LABEL_W} group/agents flex min-h-6 shrink-0 items-center gap-1.5 rounded-sm text-left`}
          >
            <ChevronRight
              className="size-3 shrink-0 text-muted-foreground transition-transform duration-150 group-aria-expanded/agents:rotate-90"
              aria-hidden
            />
            <span className="truncate group-hover/agents:underline" title={group.label}>
              {group.label}
            </span>
            <span className="shrink-0 rounded bg-muted px-1 text-xs text-muted-foreground">×{group.count}</span>
            <span className="sr-only">
              {open ? "Collapse" : "Expand"} {group.label} agents
            </span>
          </button>
        )}
        <CostBar value={group.costUsd} max={max} className="min-w-0 flex-1" />
        <span className="w-20 shrink-0 text-right text-muted-foreground">{formatCost(group.costUsd)}</span>
      </div>
      {open && group.count > 1 && (
        <ul className="mt-1.5 ml-[1.125rem] flex flex-col gap-1 border-l border-border/60 pl-3">
          {group.agents.map((a) => (
            <li key={a.agentId}>
              {/* Deep-link into this agent's transcript. `a.agentId` is the
                  `?agent=` key (`externalAgentId ?? String(id)`) the transcript
                  route resolves — a direct pass-through, no re-derivation. */}
              <Link
                href={withListReturn(agentHref(sessionId, a.agentId), listReturn)}
                className="group/agent flex min-h-6 items-center justify-between gap-4 rounded-sm text-xs text-foreground/80 hover:text-foreground"
              >
                <span className="flex min-w-0 items-center gap-1">
                  <span className="truncate group-hover/agent:underline" title={a.model || undefined}>
                    {a.model || "—"}
                  </span>
                  <ArrowUpRight
                    className="size-3 shrink-0 opacity-0 transition-opacity group-hover/agent:opacity-60"
                    aria-hidden
                  />
                </span>
                <span className="flex shrink-0 gap-4 text-muted-foreground">
                  <span>{formatTokens(a.tokens.total)} tok</span>
                  <span className="w-16 text-right">{formatCost(a.costUsd)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
