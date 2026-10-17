// The overview band (the app's analysis surface): one compact strip of headline
// figures above the conversation table, under a heading that says they cover
// every Project. A SERVER component — it receives the already-derived
// `Overview` as plain props (ADR-0002: no core import here).
//
// The cost ranking of Projects lives in the folder sidebar beside it (each
// entry carries its cost and share bar), so the band does not repeat it.

import {
  formatCompactTokens,
  formatCount,
  formatDateRange,
  formatGrandTotalCost,
  formatTokens,
} from "@/app/_lib/format";
import { Stat, StatStrip } from "@/app/_components/stat-strip";
import { type Overview } from "@/app/_lib/overview";

/**
 * The headline figures across all Projects. When the page is scoped to a
 * folder, the heading line says these figures are not, and where the folder's
 * own totals are.
 *
 * @example <OverviewBand overview={overview} selectedFolderLabel="acme-api" />
 */
export function OverviewBand({
  overview,
  selectedFolderLabel,
}: {
  overview: Overview;
  /** The selected folder's label when the list is scoped to one. */
  selectedFolderLabel?: string;
}) {
  const cost = formatGrandTotalCost(overview.totalCost);
  const range = formatDateRange(overview.earliest, overview.latest);
  const projects = `${formatCount(overview.projectCount)} project${overview.projectCount === 1 ? "" : "s"}`;
  return (
    <section aria-labelledby="overview-heading" className="mb-6">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="overview-heading" className="text-sm font-medium text-foreground">
          All projects
          {range && <span className="ml-2 font-normal text-muted-foreground">{range}</span>}
        </h2>
        {selectedFolderLabel && (
          <p className="text-xs text-muted-foreground">
            Not filtered by folder. {selectedFolderLabel} totals are in the table footer.
          </p>
        )}
      </div>
      <StatStrip className="grid-cols-2 sm:grid-cols-4">
        <Stat label="Total cost" hint={overview.hasUnpriced ? "Lower bound" : "At API list prices"}>
          <span
            className="text-cost-foreground"
            {...(overview.hasUnpriced
              ? { title: "Some usage is on a model without a known price, counted as $0." }
              : {})}
          >
            {overview.hasUnpriced ? `~${cost}` : cost}
          </span>
        </Stat>
        <Stat label="Tokens" hint={`${formatTokens(overview.tokens.total)} total`}>
          {formatCompactTokens(overview.tokens.total)}
        </Stat>
        <Stat label="Conversations" hint={`In ${projects}`}>
          {formatCount(overview.conversationCount)}
        </Stat>
        <Stat label="Cache read" hint="Share of all tokens">
          {Math.round(overview.cacheReadRatio * 100)}
          <span className="text-lg font-normal text-muted-foreground">%</span>
        </Stat>
      </StatStrip>
    </section>
  );
}
