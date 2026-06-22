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
import { formatCost, formatDate, formatTokens } from "@/app/_lib/format";
import { detailSections } from "@/app/_lib/detail";
import { modelLabel } from "@/app/_lib/sort";
import { TableCell, TableRow } from "@/components/ui/table";
import type { ConversationDetail, ConversationSummary } from "@/core/refresh";

/** The number of list columns — the detail panel spans all of them. */
const COLUMN_COUNT = 6;

type DetailState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; detail: ConversationDetail }
  | { status: "empty" }
  | { status: "error" };

export function ConversationRow({ row }: { row: ConversationSummary }) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<DetailState>({ status: "idle" });
  const [, startTransition] = useTransition();
  const model = modelLabel(row.models);
  const date = formatDate(row.startedAt);

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
          {date.label}
        </TableCell>
        <TableCell title={row.project.path} className="text-muted-foreground">
          <button
            type="button"
            onClick={toggle}
            aria-expanded={expanded}
            className="inline-flex items-center gap-1.5 text-left hover:underline"
          >
            {expanded ? (
              <ChevronDown className="size-3.5 shrink-0" aria-hidden />
            ) : (
              <ChevronRight className="size-3.5 shrink-0" aria-hidden />
            )}
            <span className="sr-only">
              {expanded ? "Collapse" : "Expand"} conversation details
            </span>
            {row.project.folder}
          </button>
        </TableCell>
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
        <TableCell className="text-right tabular-nums">
          {formatTokens(row.tokens.total)}
        </TableCell>
        <TableCell className="text-right tabular-nums">
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
          <TableCell colSpan={COLUMN_COUNT} className="bg-muted/30 p-0">
            <DetailPanel state={detail} tokens={row.tokens} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/**
 * Render the detail panel. The Token breakdown renders IMMEDIATELY from the row
 * summary's `tokens` (no fetch); the lazily-fetched sections (Per-model /
 * Sub-agents / Per-Skill) show their own loading / error / empty / loaded state.
 */
function DetailPanel({
  state,
  tokens,
}: {
  state: DetailState;
  tokens: ConversationSummary["tokens"];
}) {
  return (
    <div className="grid gap-6 px-4 py-4 md:grid-cols-3">
      <Section title="Token breakdown">
        <Breakdown
          head={["Bucket", "Tokens"]}
          rows={[
            { key: "input", cells: ["Input", formatTokens(tokens.input)] },
            { key: "output", cells: ["Output", formatTokens(tokens.output)] },
            {
              key: "cacheWrite",
              cells: ["Cache-write", formatTokens(tokens.cacheWrite)],
            },
            {
              key: "cacheRead",
              cells: ["Cache-read", formatTokens(tokens.cacheRead)],
            },
          ]}
        />
      </Section>
      <LazyDetailSections state={state} />
    </div>
  );
}

/** The detail sections fetched on first expand: loading / error / empty / loaded. */
function LazyDetailSections({ state }: { state: DetailState }) {
  if (state.status === "loading" || state.status === "idle") {
    return (
      <p
        className="text-sm text-muted-foreground md:col-span-2"
        aria-live="polite"
      >
        Loading details…
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <p className="text-sm text-destructive md:col-span-2" role="alert">
        Could not load details. Try again.
      </p>
    );
  }
  if (state.status === "empty") {
    return (
      <p className="text-sm text-muted-foreground md:col-span-2">
        No detail available for this conversation.
      </p>
    );
  }

  const sections = detailSections(state.detail);
  return (
    <>
      <Section title="Per-model cost">
        {sections.perModel.isEmpty ? (
          <NoneNote>No model usage.</NoneNote>
        ) : (
          <Breakdown
            head={["Model", "Tokens", "Cost"]}
            rows={sections.perModel.rows.map((m) => ({
              key: m.model,
              cells: [
                m.model,
                formatTokens(m.tokens.total),
                m.unpriced ? (
                  <span
                    key="c"
                    title="Excludes unpriced usage — lower bound."
                  >
                    ~{formatCost(m.costUsd)}
                  </span>
                ) : (
                  formatCost(m.costUsd)
                ),
              ],
            }))}
          />
        )}
      </Section>

      <Section title="Sub-agents">
        {sections.subAgents.isEmpty ? (
          <NoneNote>No sub-agents.</NoneNote>
        ) : (
          <Breakdown
            head={["Agent", "Model", "Tokens", "Cost"]}
            rows={sections.subAgents.rows.map((s) => ({
              key: s.agentId,
              cells: [
                s.label,
                s.model || "—",
                formatTokens(s.tokens.total),
                formatCost(s.costUsd),
              ],
            }))}
          />
        )}
      </Section>

      <Section title="Per-Skill cost">
        {sections.perSkill.isEmpty ? (
          <NoneNote>No Skill usage.</NoneNote>
        ) : (
          <Breakdown
            head={["Skill", "Tokens", "Cost"]}
            rows={sections.perSkill.rows.map((s) => ({
              key: s.skill,
              cells: [
                s.skill,
                formatTokens(s.tokens.total),
                formatCost(s.costUsd),
              ],
            }))}
          />
        )}
      </Section>
    </>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </div>
  );
}

function NoneNote({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

/** A small breakdown table: a header row plus one row per entry. The first
 *  column reads left; the remaining (numeric) columns are right-aligned. */
function Breakdown({
  head,
  rows,
}: {
  head: string[];
  rows: { key: string; cells: React.ReactNode[] }[];
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-muted-foreground">
          {head.map((h, i) => (
            <th
              key={h}
              className={i === 0 ? "text-left font-normal" : "text-right font-normal"}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-t border-border/50">
            {r.cells.map((cell, i) => (
              <td
                key={i}
                className={
                  i === 0
                    ? "py-1 text-left"
                    : "py-1 text-right tabular-nums"
                }
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
