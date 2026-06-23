"use client";

// The expandable conversation row (slice 4). A client component because it owns
// the per-row expand/collapse state and lazily fetches detail. Per ADR-0002 it
// does NOT import core: it receives the row's `ConversationSummary` as plain
// props (the type import is erased) and, on first expand, calls the
// `getConversationDetail` server action — which is the only place core is touched.
//
// The first cell is a toggle button (click + keyboard, with `aria-expanded`);
// the shadcn TableRow's `has-aria-expanded:bg-muted/50` highlights an open row.
// On expand we show a brief loading state, then a detail panel rendered in a
// second, full-width TableRow; an unknown id / error shows a graceful note.

import { ChevronDown, ChevronRight } from "lucide-react";
import { useState, useTransition } from "react";

import { getConversationDetail } from "@/app/actions";
import { CostBar } from "@/app/_components/cost-bar";
import { columnCount } from "@/app/_lib/columns";
import {
  detailSections,
  tokenComposition,
  type SubAgentGroup,
  type SubAgentSection,
} from "@/app/_lib/detail";
import { friendlyFolderName } from "@/app/_lib/folders";
import {
  formatCompactTokens,
  formatCost,
  formatDuration,
  formatTokens,
} from "@/app/_lib/format";
import { modelLabel } from "@/app/_lib/sort";
import { TableCell, TableRow } from "@/components/ui/table";
import type { ConversationDetail, ConversationSummary } from "@/core/read";

type DetailState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; detail: ConversationDetail }
  | { status: "empty" }
  | { status: "error" };

export function ConversationRow({
  row,
  // The Date cell's label/title, formatted ON THE SERVER against a single
  // request-time `now` (see page.tsx). It MUST arrive as a plain prop: this is a
  // client component, so computing a relative "Nm ago"/"just now" label here with
  // `new Date()` would differ between the server render and client hydration and
  // throw a React hydration mismatch (#418) — which, inside the Refresh
  // transition, froze the button on "Scanning…" (issue #20).
  date,
  // `scoped` is true when the table is filtered to a single Project (an active
  // `?folder=`). When scoped, every visible row shares that Project, so the
  // Folder cell is redundant and hidden — the page shows the path once as a
  // breadcrumb instead. The expand toggle therefore lives on the Date cell so
  // rows stay expandable in BOTH states.
  scoped = false,
}: {
  row: ConversationSummary;
  date: { label: string; absolute: string };
  scoped?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<DetailState>({ status: "idle" });
  const [, startTransition] = useTransition();
  const model = modelLabel(row.models);

  function toggle() {
    const next = !expanded;
    setExpanded(next);
    // Lazy fetch: only on the FIRST expand (issue #3: "Expanding a row calls
    // getConversation()"). Re-expanding a row we already loaded reuses it.
    if (next && detail.status === "idle") {
      setDetail({ status: "loading" });
      startTransition(async () => {
        try {
          const result = await getConversationDetail(row.id);
          setDetail(
            result === null
              ? { status: "empty" }
              : { status: "loaded", detail: result },
          );
        } catch {
          setDetail({ status: "error" });
        }
      });
    }
  }

  return (
    <>
      <TableRow>
        <TableCell
          {...(date.absolute ? { title: date.absolute } : {})}
          className="text-muted-foreground tabular-nums"
        >
          {/* Expand toggle lives here so it works whether or not the Folder
              cell is rendered (it's hidden when scoped). */}
          <button
            type="button"
            onClick={toggle}
            aria-expanded={expanded}
            className="inline-flex items-center gap-1.5 rounded-sm text-left outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {expanded ? (
              <ChevronDown className="size-3.5 shrink-0" aria-hidden />
            ) : (
              <ChevronRight className="size-3.5 shrink-0" aria-hidden />
            )}
            <span className="sr-only">
              {expanded ? "Collapse" : "Expand"} conversation details
            </span>
            {date.label}
          </button>
        </TableCell>
        {/* When scoped to a single Project the Folder column is hidden (the page
            shows the path once as a breadcrumb). When unscoped, show the friendly
            basename; the full Project path is available on hover via the cell's
            title (kept off-screen so long paths don't break the table — #14). */}
        {!scoped && (
          <TableCell title={row.project.path}>
            <span className="font-medium">
              {friendlyFolderName(row.project.path)}
            </span>
          </TableCell>
        )}
        <TableCell className="max-w-xs truncate font-medium">
          {row.title ?? <span className="text-muted-foreground">{row.id}</span>}
        </TableCell>
        <TableCell>
          <span className="inline-flex items-center gap-1">
            {model.dominant || <span className="text-muted-foreground">—</span>}
            {model.extra > 0 && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                +{model.extra}
              </span>
            )}
          </span>
        </TableCell>
        {/* Token total is secondary context → muted. Cost is the payload →
            full-weight foreground, so the eye lands on spend first. */}
        <TableCell className="text-right tabular-nums text-muted-foreground">
          {formatTokens(row.tokens.total)}
        </TableCell>
        <TableCell className="text-right font-medium tabular-nums">
          {row.unpriced ? (
            <span title="Cost excludes unpriced model usage — lower bound.">
              ~{formatCost(row.costUsd)}
            </span>
          ) : (
            formatCost(row.costUsd)
          )}
        </TableCell>
      </TableRow>

      {expanded && (
        <TableRow>
          <TableCell colSpan={columnCount(scoped)} className="bg-muted/30 p-0">
            <DetailPanel state={detail} row={row} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/**
 * Render the detail panel — the analysis surface for one conversation. The
 * summary strip and the token-composition bar render IMMEDIATELY from the row
 * summary (no fetch); the lazily-fetched cost breakdowns (Model / Sub-agents /
 * Skill) show their own loading / error / empty / loaded state to the right.
 */
function DetailPanel({
  state,
  row,
}: {
  state: DetailState;
  row: ConversationSummary;
}) {
  const loaded = state.status === "loaded" ? state.detail : null;
  return (
    <div className="space-y-6 px-6 py-5">
      <SummaryStrip row={row} detail={loaded} />
      <div className="grid gap-x-10 gap-y-6 lg:grid-cols-[16rem_1fr]">
        <Section title="Token composition">
          <TokenComposition
            tokens={row.tokens}
            costByType={row.costByType}
            unpriced={row.unpriced}
          />
        </Section>
        <div className="space-y-6">
          <LazyBreakdowns state={state} />
        </div>
      </div>
    </div>
  );
}

/**
 * The orienting headline: the conversation's cost (the payload, in the cost
 * hue) followed by a quiet meta line of the facts you'd drill into. Most facts
 * come straight from the row summary; the Skill count needs the fetched detail,
 * so it joins once loaded.
 */
function SummaryStrip({
  row,
  detail,
}: {
  row: ConversationSummary;
  detail: ConversationDetail | null;
}) {
  const duration = formatDuration(row.startedAt, row.endedAt);
  const meta = [
    `${formatCompactTokens(row.tokens.total)} tokens`,
    `${row.models.distinctCount} model${row.models.distinctCount === 1 ? "" : "s"}`,
    row.subAgentCount > 0
      ? `${row.subAgentCount} sub-agent${row.subAgentCount === 1 ? "" : "s"}`
      : null,
    detail && detail.perSkill.length > 0
      ? `${detail.perSkill.length} skill${detail.perSkill.length === 1 ? "" : "s"}`
      : null,
    duration || null,
  ].filter(Boolean);

  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="text-2xl font-semibold tabular-nums text-cost">
        {row.unpriced ? (
          <span title="Cost excludes unpriced model usage — lower bound.">
            ~{formatCost(row.costUsd)}
          </span>
        ) : (
          formatCost(row.costUsd)
        )}
      </span>
      <span className="text-sm text-muted-foreground">{meta.join(" · ")}</span>
    </div>
  );
}

/** The four token buckets, each led by its DOLLAR cost — the payload, in
 *  full-weight foreground so the eye lands on spend first (matching the row
 *  total and the panel headline). The token count and its percent of the total
 *  are the demoted secondary facts (muted), so the shape of usage (almost always
 *  cache-dominated) still reads at a glance. When the conversation includes
 *  unpriced model usage every bucket's dollars are a lower bound: prefix `~` and
 *  reuse the same tooltip the row's total cost carries. */
function TokenComposition({
  tokens,
  costByType,
  unpriced,
}: {
  tokens: ConversationSummary["tokens"];
  costByType: ConversationSummary["costByType"];
  unpriced: boolean;
}) {
  const buckets = tokenComposition(tokens, costByType);
  return (
    <ul className="space-y-1.5 text-sm">
      {buckets.map((b) => (
        <li key={b.key} className="flex items-center gap-3">
          <span className="text-muted-foreground">{b.label}</span>
          <span className="ml-auto w-16 text-right font-medium tabular-nums">
            {unpriced ? (
              <span title="Cost excludes unpriced model usage — lower bound.">
                ~{formatCost(b.costUsd)}
              </span>
            ) : (
              formatCost(b.costUsd)
            )}
          </span>
          <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">
            {formatCompactTokens(b.tokens)}
          </span>
          <span className="w-9 text-right text-xs text-muted-foreground tabular-nums">
            {b.percent}%
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The cost breakdowns fetched on first expand: loading / error / empty / loaded. */
function LazyBreakdowns({ state }: { state: DetailState }) {
  if (state.status === "loading" || state.status === "idle") {
    return (
      <p className="text-sm text-muted-foreground" aria-live="polite">
        Loading breakdown…
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <p className="text-sm text-destructive" role="alert">
        Could not load details. Try again.
      </p>
    );
  }
  if (state.status === "empty") {
    return (
      <p className="text-sm text-muted-foreground">
        No detail available for this conversation.
      </p>
    );
  }

  const sections = detailSections(state.detail);
  return (
    <>
      <Section title="Cost by model">
        {sections.perModel.isEmpty ? (
          <NoneNote>No model usage.</NoneNote>
        ) : (
          <CostList>
            {sections.perModel.rows.map((m) => (
              <CostRow
                key={m.model}
                label={m.model}
                costUsd={m.costUsd}
                max={sections.perModel.totalCost}
                unpriced={m.unpriced}
              />
            ))}
          </CostList>
        )}
      </Section>

      <Section title="Cost by skill">
        {sections.perSkill.isEmpty ? (
          <NoneNote>No Skill usage.</NoneNote>
        ) : (
          <CostList>
            {sections.perSkill.rows.map((s) => (
              <CostRow
                key={s.skill}
                label={s.skill}
                costUsd={s.costUsd}
                max={sections.perSkill.totalCost}
              />
            ))}
          </CostList>
        )}
      </Section>

      <Section title="Cost by sub-agent">
        {sections.subAgents.isEmpty ? (
          <NoneNote>No sub-agents.</NoneNote>
        ) : (
          <SubAgentBreakdown section={sections.subAgents} />
        )}
      </Section>
    </>
  );
}

/** The width of the leading label column, shared so every bar starts aligned. */
const LABEL_W = "w-40";

/** A ranked cost list: each row pairs a share-of-total bar with its label and
 *  cost, mirroring the overview band's "top projects by cost" language. */
function CostList({ children }: { children: React.ReactNode }) {
  return <ul className="flex flex-col gap-2">{children}</ul>;
}

function CostRow({
  label,
  costUsd,
  max,
  unpriced = false,
}: {
  label: string;
  costUsd: number;
  /** The breakdown's TOTAL cost → each bar reads as a share of the whole. */
  max: number;
  unpriced?: boolean;
}) {
  return (
    <li className="flex items-center gap-3 text-sm">
      <span className={`${LABEL_W} shrink-0 truncate`} title={label}>
        {label}
      </span>
      <CostBar value={costUsd} max={max} className="min-w-0 flex-1" />
      <span className="w-20 shrink-0 text-right tabular-nums text-muted-foreground">
        {unpriced ? "~" : ""}
        {formatCost(costUsd)}
      </span>
    </li>
  );
}

/** Sub-agents grouped by type: each group is a ranked cost bar that expands to
 *  reveal its individual agents. Owns the per-group open/closed state. */
function SubAgentBreakdown({ section }: { section: SubAgentSection }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <CostList>
      {section.groups.map((g) => (
        <SubAgentGroupRow
          key={g.label}
          group={g}
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
  max,
  open,
  onToggle,
}: {
  group: SubAgentGroup;
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
            <li
              key={a.agentId}
              className="flex items-center justify-between gap-4 text-xs text-muted-foreground"
            >
              <span className="truncate" title={a.model || undefined}>
                {a.model || "—"}
              </span>
              <span className="flex shrink-0 gap-4 tabular-nums">
                <span>{formatTokens(a.tokens.total)}</span>
                <span className="w-16 text-right">{formatCost(a.costUsd)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** A section: a quiet uppercase label (the panel's only uppercase element) over
 *  its content — the same label treatment as the overview stat cards. */
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </div>
  );
}

function NoneNote({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}
