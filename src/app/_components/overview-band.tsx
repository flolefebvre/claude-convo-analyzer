import { CostBar } from "@/app/_components/cost-bar";
import { type FolderEntry } from "@/app/_lib/folders";
import { formatCompactTokens, formatDateRange, formatGrandTotalCost, formatTokens } from "@/app/_lib/format";
import { type Overview } from "@/app/_lib/overview";

export function OverviewBand({ overview, topProjects }: { overview: Overview; topProjects: FolderEntry[] }) {
  const cost = formatGrandTotalCost(overview.totalCost);
  const range = formatDateRange(overview.earliest, overview.latest);
  const span = [`${overview.projectCount} project${overview.projectCount === 1 ? "" : "s"}`, range]
    .filter(Boolean)
    .join(" · ");
  return (
    <section aria-label="Usage overview" className="mb-8 flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total cost">
          <span className="text-cost">
            {overview.hasUnpriced ? <span title="Includes unpriced model usage — a lower bound.">~{cost}</span> : cost}
          </span>
        </StatCard>
        <StatCard label="Tokens" hint={`${formatTokens(overview.tokens.total)} total`}>
          {formatCompactTokens(overview.tokens.total)}
        </StatCard>
        <StatCard label="Conversations" hint={span}>
          {overview.conversationCount}
        </StatCard>
        <StatCard label="Cache read">
          {Math.round(overview.cacheReadRatio * 100)}
          <span className="text-xl font-normal text-muted-foreground">%</span>
        </StatCard>
      </div>

      {topProjects.length > 0 && <TopProjects projects={topProjects} totalCost={overview.totalCost} />}
    </section>
  );
}

function StatCard({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-5">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums">{children}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function TopProjects({ projects, totalCost }: { projects: FolderEntry[]; totalCost: number }) {
  return (
    <div className="rounded-xl border bg-card p-5">
      <p className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">Top projects by cost</p>
      <ul className="flex flex-col gap-2.5">
        {projects.map((p) => (
          <li key={p.folder} className="flex items-center gap-3 text-sm">
            <span className="w-40 shrink-0 truncate" title={p.path}>
              {p.label}
            </span>
            <CostBar value={p.costUsd} max={totalCost} className="min-w-0 flex-1" />
            <span className="w-20 shrink-0 text-right text-muted-foreground tabular-nums">
              {p.unpriced ? "~" : ""}
              {formatGrandTotalCost(p.costUsd)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
