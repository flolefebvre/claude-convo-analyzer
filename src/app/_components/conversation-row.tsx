// The expandable conversation row. A SERVER component: whether a row is
// expanded is URL view state (`?expanded=<id>`), same as sort and folder scope,
// so the page resolves it from `searchParams`, fetches the panel's detail
// server-side, and hands both down as plain props. The expand toggle is the
// shared `ExpandToggle` pointed at `expandHref(...)` — the same href-composition
// pattern as the sortable headers and folder links. Expanded views are
// therefore shareable and survive a reload.
//
// ADR-0002 boundary: no client file touches core. The only client leaf left in
// the panel is `SubAgentBreakdown` (ephemeral per-group open/closed state),
// which receives plain serializable props.

import { AlertTriangle, GitBranch } from "lucide-react";
import Link from "next/link";

import { CostList, CostRow } from "@/app/_components/cost-list";
import { ExpandToggle } from "@/app/_components/expand-toggle";
import { SubAgentBreakdown } from "@/app/_components/sub-agent-breakdown";
import { columnCount } from "@/app/_lib/columns";
import { detailSections, tokenComposition } from "@/app/_lib/detail";
import type { ErrorViewRow } from "@/app/_lib/errors-view";
import type { FamilyView } from "@/app/_lib/family-view";
import { friendlyFolderName } from "@/app/_lib/folders";
import { PendingLink } from "@/app/_components/pending-link";
import { formatCompactTokens, formatCost, formatDuration, formatModelName, formatTokens } from "@/app/_lib/format";
import { modelLabel } from "@/app/_lib/sort";
import { agentHref, withListReturn } from "@/app/_lib/transcript-url";
import { TableCell, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ConversationDetail, ConversationSummary } from "@/core/read";

/**
 * Width and visibility of each conversation-table column, shared by the page's
 * header cells and the row's cells. The table is `table-fixed` inside an
 * `@container`: Title takes what the fixed columns leave, Total appears at
 * `@xl`, Folder and Model(s) at `@4xl`; Date and Cost are always there. The
 * first and last columns carry the card's inset (a sortable header takes `pl-2`
 * / `pr-2` instead, since its link adds `px-2`).
 */
export const CONVERSATION_COLUMNS = {
  date: "w-12 pl-4 @xl:w-36",
  folder: "hidden w-32 @4xl:table-cell",
  title: "w-full",
  model: "hidden w-32 @4xl:table-cell",
  total: "hidden w-24 @xl:table-cell",
  cost: "w-24 pr-4 @xl:w-28",
} as const;

/**
 * One conversation as a table row, plus its detail panel row when expanded.
 *
 * @example <ConversationRow row={row} date={formatDate(row.startedAt, now)} toggleHref={expandHref(row.id, expandedId, links)} />
 */
export function ConversationRow({
  row,
  // The Date cell's label/title, formatted by the page against a single
  // request-time `now` so every row's relative label agrees (see page.tsx).
  date,
  // `scoped` is true when the table is filtered to a single Project (an active
  // `?folder=`). When scoped, every visible row shares that Project, so the
  // Folder cell is redundant and hidden — the page shows the path once as a
  // breadcrumb instead. The expand toggle therefore lives on the Date cell so
  // rows stay expandable in BOTH states.
  scoped = false,
  // True when this row is the URL's `?expanded=` target; `detail` is that
  // row's server-fetched panel data (`null` when collapsed or unknown id).
  expanded = false,
  detail = null,
  // Size of this row's continuation family (issue #46) — 1 for a standalone
  // conversation, which renders no badge at all.
  familySize = 1,
  // The expanded row's continuation family, already shaped for rendering by the
  // page (`null` when standalone or collapsed).
  family = null,
  // The expanded row's failed turns, already shaped by the page (`null` when
  // collapsed; `[]` when the conversation never failed).
  errors = null,
  // The row's expand/collapse toggle target (built by the page via expandHref).
  toggleHref,
  // The list view as a query (`listReturnQuery`), carried on every link into a
  // transcript so its back link returns to this view.
  listReturn,
}: {
  row: ConversationSummary;
  date: { label: string; absolute: string };
  scoped?: boolean;
  expanded?: boolean;
  detail?: ConversationDetail | null;
  familySize?: number;
  family?: FamilyView | null;
  errors?: ErrorViewRow[] | null;
  toggleHref: string;
  listReturn?: string;
}) {
  const model = modelLabel(row.models);
  const folder = friendlyFolderName(row.project.path);

  return (
    <>
      {/* No row hover wash: only the chevron and the title are targets, and a
          highlighted row would promise a click the row does not answer. */}
      <TableRow className="hover:bg-transparent">
        {/* The expand toggle lives here so it works whether or not the Folder
            cell is rendered (it's hidden when scoped). Below `@xl` the column
            narrows to the chevron and the date moves under the title. */}
        <TableCell className={`${CONVERSATION_COLUMNS.date} text-muted-foreground`}>
          <div className="flex items-center gap-1.5">
            <ExpandToggle href={toggleHref} expanded={expanded} label="conversation details" />
            <span className="hidden truncate @xl:inline" {...(date.absolute ? { title: date.absolute } : {})}>
              {date.label}
            </span>
          </div>
        </TableCell>
        {/* When scoped to a single Project the Folder column is hidden (the page
            shows the path once as a breadcrumb). When unscoped, show the friendly
            basename; the full Project path is available on hover via the cell's
            title (kept off-screen so long paths don't break the table — #14). */}
        {!scoped && (
          <TableCell
            title={row.project.path}
            className={`${CONVERSATION_COLUMNS.folder} truncate text-muted-foreground`}
          >
            {folder}
          </TableCell>
        )}
        {/* The title deep-links into the Transcript view for this conversation
            (`/conversation/<sessionId>`; `row.id` IS the stable sessionId). Bare
            path → the main/root agent. It takes the width the fixed columns
            leave; the badges sit outside its truncation, in a fixed order. */}
        <TableCell className="font-medium">
          {/* One truncated line where the columns leave room; two lines in the
              compact layout, where the title shares a phone's width with Cost. */}
          <div className="flex min-w-0 items-start gap-1.5 @xl:items-center">
            <Link
              href={withListReturn(agentHref(row.id), listReturn)}
              title={row.title ?? undefined}
              className="min-w-0 rounded-sm break-words hover:underline focus-visible:whitespace-normal @max-xl:line-clamp-2 @max-xl:whitespace-normal @xl:truncate"
            >
              {row.title ?? <span className="text-muted-foreground">{row.id}</span>}
            </Link>
            {/* API errors: turns the API failed on, anywhere in the
                conversation (sub-agents included). Destructive tone, the same
                alarm the Transcript's `badge-err` carries — expand the row for
                the per-error list. */}
            {row.errorCount > 0 && (
              <span
                className="inline-flex shrink-0 items-center gap-1 rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-normal text-destructive-foreground dark:bg-destructive/20"
                title={`${row.errorCount} turn${row.errorCount === 1 ? "" : "s"} failed with an API error — expand the row to see them.`}
              >
                <AlertTriangle className="size-3" aria-hidden />
                {row.errorCount}
                <span className="sr-only @2xl:not-sr-only">error{row.errorCount === 1 ? "" : "s"}</span>
              </span>
            )}
            {/* Continuation family: this conversation is one sitting of a piece
                of work spread over several (`--resume`/fork). The badge counts
                the WHOLE family, so every member shows the same number. */}
            {familySize > 1 && (
              <span
                className="inline-flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground"
                title={`Part of a continuation family of ${familySize} conversations — expand the row for the family tree.`}
              >
                <GitBranch className="size-3" aria-hidden />
                {familySize}
                <span className="sr-only"> conversations in this continuation family</span>
              </span>
            )}
          </div>
          {/* What the hidden columns would say, under the title: the date below
              `@xl`, the folder until its own column appears at `@4xl`. */}
          <div
            className={`mt-0.5 flex min-w-0 items-center gap-1.5 text-xs font-normal text-muted-foreground ${
              scoped ? "@xl:hidden" : "@4xl:hidden"
            }`}
          >
            <span className="shrink-0 @xl:hidden" {...(date.absolute ? { title: date.absolute } : {})}>
              {date.label}
            </span>
            {!scoped && (
              <>
                <span aria-hidden className="@xl:hidden">
                  ·
                </span>
                <span className="truncate" title={row.project.path}>
                  {folder}
                </span>
              </>
            )}
          </div>
        </TableCell>
        <TableCell className={CONVERSATION_COLUMNS.model}>
          <ModelCell
            dominant={model.dominant}
            extra={model.extra}
            unpriced={row.unpriced}
            detailsHref={expanded ? null : toggleHref}
          />
        </TableCell>
        {/* Token total is secondary context → muted. Cost is the payload →
            full-weight foreground, so the eye lands on spend first. */}
        <TableCell className={`${CONVERSATION_COLUMNS.total} text-right text-muted-foreground`}>
          {formatTokens(row.tokens.total)}
        </TableCell>
        <TableCell className={`${CONVERSATION_COLUMNS.cost} text-right font-medium`}>
          {row.unpriced ? (
            <span title="Cost excludes unpriced model usage — lower bound.">~{formatCost(row.costUsd)}</span>
          ) : (
            formatCost(row.costUsd)
          )}
        </TableCell>
      </TableRow>

      {expanded && (
        <TableRow>
          <TableCell colSpan={columnCount(scoped)} className="bg-muted/30 p-0">
            <DetailPanel detail={detail} row={row} family={family} errors={errors} listReturn={listReturn} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/**
 * The dominant model, shortened for the column (full id on hover), and a "+N"
 * pill for the others. While the row is collapsed the pill links to its panel,
 * whose "Cost by model" lists them, and explains itself in a tooltip.
 */
function ModelCell({
  dominant,
  extra,
  unpriced,
  detailsHref,
}: {
  dominant: string;
  extra: number;
  unpriced: boolean;
  /** The row's expand href, or `null` when the panel is already open. */
  detailsHref: string | null;
}) {
  if (!dominant) return <span className="text-muted-foreground">—</span>;
  const others = `${extra} more model${extra === 1 ? "" : "s"}`;
  const pill = "shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground";
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="truncate text-muted-foreground" title={dominant}>
        {formatModelName(dominant)}
      </span>
      {extra > 0 &&
        (detailsHref === null ? (
          <span className={pill}>
            <span aria-hidden>+{extra}</span>
            <span className="sr-only">{others}</span>
          </span>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <PendingLink
                href={detailsHref}
                scroll={false}
                className={`${pill} transition-colors hover:bg-accent hover:text-foreground`}
              >
                <span aria-hidden>+{extra}</span>
                <span className="sr-only">{others}, show cost by model</span>
              </PendingLink>
            </TooltipTrigger>
            <TooltipContent side="top" className="flex-col items-start gap-0.5">
              <span className="font-medium">{others}</span>
              {unpriced && <span>Includes usage on a model without a known price.</span>}
              <span>Open the row for cost by model.</span>
            </TooltipContent>
          </Tooltip>
        ))}
    </div>
  );
}

/**
 * Render the detail panel — the analysis surface for one conversation. The
 * summary strip and the token-composition bar come straight from the row
 * summary; the cost breakdowns (Model / Skill / Sub-agents) come from the
 * server-fetched detail, with a graceful note when the id is unknown.
 */
function DetailPanel({
  detail,
  row,
  family,
  errors,
  listReturn,
}: {
  detail: ConversationDetail | null;
  row: ConversationSummary;
  family: FamilyView | null;
  errors: ErrorViewRow[] | null;
  listReturn: string | undefined;
}) {
  return (
    <div className="space-y-6 px-4 py-5">
      <SummaryStrip row={row} detail={detail} />
      {/* Failed turns lead the panel: a conversation that hit the API's limits
          is the most urgent thing to know about it. Absent when nothing failed. */}
      {errors !== null && errors.length > 0 && (
        <Section title="API errors">
          <ErrorList errors={errors} listReturn={listReturn} />
        </Section>
      )}
      {/* The family sits above the breakdowns (and below the failures): it
          reframes every number under it as one sitting of a larger piece of
          work. Absent for a standalone row. */}
      {family && family.size > 1 && (
        <Section title="Continuation family">
          <FamilyTree family={family} />
        </Section>
      )}
      <div className="grid gap-x-10 gap-y-6 @3xl:grid-cols-[17rem_1fr]">
        <Section title="Token composition">
          <TokenComposition tokens={row.tokens} costByType={row.costByType} unpriced={row.unpriced} />
        </Section>
        <div className="space-y-6">
          {detail === null ? (
            <p className="text-sm text-muted-foreground">No detail available for this conversation.</p>
          ) : (
            // `row.id` is the stable sessionId — threaded so the sub-agent
            // breakdown can deep-link each agent into its transcript.
            <Breakdowns detail={detail} sessionId={row.id} listReturn={listReturn} />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The orienting headline: the conversation's cost (the payload, in the cost
 * hue) followed by a quiet meta line of the facts you'd drill into. Most facts
 * come straight from the row summary; the Skill count needs the fetched detail.
 */
function SummaryStrip({ row, detail }: { row: ConversationSummary; detail: ConversationDetail | null }) {
  const duration = formatDuration(row.startedAt, row.endedAt);
  const meta = [
    `${formatCompactTokens(row.tokens.total)} tokens`,
    `${row.models.distinctCount} model${row.models.distinctCount === 1 ? "" : "s"}`,
    row.subAgentCount > 0 ? `${row.subAgentCount} sub-agent${row.subAgentCount === 1 ? "" : "s"}` : null,
    detail && detail.perSkill.length > 0
      ? `${detail.perSkill.length} skill${detail.perSkill.length === 1 ? "" : "s"}`
      : null,
    duration || null,
  ].filter(Boolean);

  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="text-2xl font-semibold text-cost-foreground tabular-nums">
        {row.unpriced ? (
          <span title="Cost excludes unpriced model usage — lower bound.">~{formatCost(row.costUsd)}</span>
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
    // A real table so the three figure columns line up whatever the label
    // length; its header is for screen readers only (the section heading and
    // the figures' own formats say enough to the eye).
    <table className="w-full text-sm">
      <thead className="sr-only">
        <tr>
          <th scope="col">Token type</th>
          <th scope="col">Cost</th>
          <th scope="col">Tokens</th>
          <th scope="col">Share of tokens</th>
        </tr>
      </thead>
      <tbody>
        {buckets.map((b) => (
          <tr key={b.key}>
            <th scope="row" className="py-0.5 pr-3 text-left font-normal text-muted-foreground">
              {b.label}
            </th>
            <td className="py-0.5 pl-3 text-right font-medium whitespace-nowrap">
              {unpriced ? (
                <span title="Cost excludes unpriced model usage — lower bound.">~{formatCost(b.costUsd)}</span>
              ) : (
                formatCost(b.costUsd)
              )}
            </td>
            <td className="py-0.5 pl-3 text-right text-xs whitespace-nowrap text-muted-foreground">
              {formatCompactTokens(b.tokens)}
            </td>
            <td className="w-0 py-0.5 pl-3 text-right text-xs whitespace-nowrap text-muted-foreground">{b.percent}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * The continuation family as a tree: every sitting of this piece of work, in
 * chronological order, indented by fork structure — the same idiom as the
 * Transcript view's agent tree (16px per level). The current conversation is
 * highlighted ("you are here"), a member from another Project carries its
 * folder label, and each row links to that conversation's own expanded panel.
 * The family total closes the section, marked as a lower bound when a member
 * has unpriced usage.
 */
function FamilyTree({ family }: { family: FamilyView }) {
  return (
    <div className="space-y-2">
      <ol className="space-y-0.5">
        {family.rows.map((member) => (
          <li key={member.id}>
            <Link
              href={member.href}
              scroll={false}
              aria-current={member.isCurrent ? "true" : undefined}
              style={{ paddingLeft: `${8 + member.depth * 16}px` }}
              className={`flex items-center gap-2 rounded-sm py-1 pr-2 text-sm hover:bg-muted ${
                member.isCurrent ? "bg-muted font-medium text-foreground" : "text-muted-foreground"
              }`}
            >
              <span aria-hidden className="shrink-0 text-xs">
                {member.depth === 0 ? "◆" : "◇"}
              </span>
              <span className="truncate">
                {member.title ?? <span className="text-muted-foreground">{member.id}</span>}
              </span>
              {member.isCurrent && <span className="sr-only">(this conversation)</span>}
              {member.projectLabel !== null && (
                <span
                  className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground"
                  title="Continued in another project"
                >
                  {member.projectLabel}
                </span>
              )}
              <span
                className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums"
                {...(member.dateAbsolute ? { title: member.dateAbsolute } : {})}
              >
                {member.dateLabel}
              </span>
              <span className="w-16 shrink-0 text-right tabular-nums">
                {member.unpriced ? (
                  <span title="Cost excludes unpriced model usage — lower bound.">~{formatCost(member.costUsd)}</span>
                ) : (
                  formatCost(member.costUsd)
                )}
              </span>
            </Link>
          </li>
        ))}
      </ol>
      <div className="flex items-center gap-2 border-t pt-2 pr-2 pl-2 text-sm">
        <span className="text-muted-foreground">Family total · {family.size} conversations</span>
        <span className="ml-auto w-16 shrink-0 text-right font-semibold text-cost-foreground tabular-nums">
          {family.hasUnpriced ? (
            <span title="Includes unpriced model usage — this total is a lower bound.">
              ~{formatCost(family.totalCostUsd)}
            </span>
          ) : (
            formatCost(family.totalCostUsd)
          )}
        </span>
      </div>
    </div>
  );
}

/**
 * The conversation's failed turns, oldest first: when it failed, which agent it
 * failed in, and what the API said. Each row links into that agent's Transcript,
 * anchored at the failing turn — the same `?msg=` deep link a search hit uses.
 */
function ErrorList({ errors, listReturn }: { errors: ErrorViewRow[]; listReturn: string | undefined }) {
  return (
    <ol className="space-y-0.5">
      {errors.map((error) => (
        <li key={error.key}>
          <Link
            href={withListReturn(error.href, listReturn)}
            className="flex items-baseline gap-2 rounded-sm px-2 py-1 text-sm hover:bg-muted"
          >
            <span
              className="shrink-0 text-xs text-muted-foreground tabular-nums"
              {...(error.timeAbsolute ? { title: error.timeAbsolute } : {})}
            >
              {error.timeLabel || "—"}
            </span>
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              {error.agentLabel}
            </span>
            {error.status && <span className="shrink-0 font-medium text-destructive-foreground">{error.status}</span>}
            <span className="truncate text-muted-foreground">{error.excerpt}</span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

/** The cost breakdowns from the server-fetched detail: Model / Skill / Sub-agent. */
function Breakdowns({
  detail,
  sessionId,
  listReturn,
}: {
  detail: ConversationDetail;
  sessionId: string;
  listReturn: string | undefined;
}) {
  const sections = detailSections(detail);
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
                label={formatModelName(m.model)}
                title={m.model}
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
              <CostRow key={s.skill} label={s.skill} costUsd={s.costUsd} max={sections.perSkill.totalCost} />
            ))}
          </CostList>
        )}
      </Section>

      <Section title="Cost by sub-agent">
        {sections.subAgents.isEmpty ? (
          <NoneNote>No sub-agents.</NoneNote>
        ) : (
          <SubAgentBreakdown section={sections.subAgents} sessionId={sessionId} listReturn={listReturn} />
        )}
      </Section>
    </>
  );
}

/** A section of the detail panel: a sentence-case heading over its content. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-3 text-sm font-medium text-foreground">{title}</h3>
      {children}
    </div>
  );
}

function NoneNote({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}
