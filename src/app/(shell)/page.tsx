import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { ConversationRow } from "@/app/_components/conversation-row";
import { OverviewBand } from "@/app/_components/overview-band";
import {
  loadConversationDetail,
  loadConversationErrors,
  loadConversations,
  loadFamily,
  loadFamilySizes,
} from "@/app/_lib/conversations";
import { footerLabelColSpan } from "@/app/_lib/columns";
import { errorsView } from "@/app/_lib/errors-view";
import { familyView } from "@/app/_lib/family-view";
import { type FolderEntry } from "@/app/_lib/folders";
import { formatDate, formatGrandTotalCost, formatTokens } from "@/app/_lib/format";
import { buildListView } from "@/app/_lib/list-view";
import { type ViewSearchParams, firstParam } from "@/app/_lib/search-params";
import {
  type ListLinkContext,
  type SortableField,
  errorsHref,
  expandHref,
  folderHref,
  resolveErrorsOnly,
  resolveExpanded,
  resolveSort,
  sortHref,
  sortIndicator,
} from "@/app/_lib/sort";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function Page({ searchParams }: { searchParams: Promise<ViewSearchParams> }) {
  return (
    <>
      <Suspense fallback={null}>
        <Overview />
      </Suspense>

      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading conversations…</p>}>
        <ConversationTable searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Overview() {
  const allRows = await loadConversations();
  const { overview, topProjects } = buildListView(allRows);
  return <OverviewBand overview={overview} topProjects={topProjects} />;
}

async function ConversationTable({ searchParams }: { searchParams: Promise<ViewSearchParams> }) {
  const params = await searchParams;
  const sort = resolveSort(params.sortBy, params.dir);
  const activeFolder = firstParam(params.folder) || undefined;
  const expandedId = resolveExpanded(params.expanded);
  const range = firstParam(params.range) || undefined;
  const errorsOnly = resolveErrorsOnly(params.errors);
  const links: ListLinkContext = { sort, folder: activeFolder, range, errorsOnly };
  const allRows = await loadConversations();
  const {
    rows,
    scoped: isScoped,
    selectedFolder,
    grandTotal: total,
  } = buildListView(allRows, { folder: activeFolder, sort, errorsOnly });

  const familySize = await loadFamilySizes();

  const expandedRow = expandedId ? rows.find((row) => row.id === expandedId) : undefined;
  const expandedDetail = expandedRow ? await loadConversationDetail(expandedRow.id) : null;

  const expandedErrors = expandedRow ? errorsView(expandedRow.id, await loadConversationErrors(expandedRow.id)) : null;

  const now = new Date();

  const expandedFamily = expandedRow ? await loadFamily(expandedRow.id) : null;
  const expandedFamilyView = expandedFamily ? familyView(expandedFamily, links, now) : null;

  if (rows.length === 0) {
    return (
      <>
        <ListControls folder={selectedFolder} links={links} />
        <EmptyState scoped={isScoped} links={links} />
      </>
    );
  }

  return (
    <>
      <ListControls folder={selectedFolder} links={links} />

      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead field="date" links={links}>
                Date
              </SortableHead>
              {!isScoped && (
                <SortableHead field="folder" links={links}>
                  Folder
                </SortableHead>
              )}
              <SortableHead field="title" links={links}>
                Title
              </SortableHead>
              <SortableHead field="model" links={links}>
                Model(s)
              </SortableHead>
              <SortableHead field="total" links={links} className="text-right">
                Total
              </SortableHead>
              <SortableHead field="cost" links={links} className="text-right">
                Cost
              </SortableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {rows.map((row) => (
              <ConversationRow
                key={row.id}
                row={row}
                date={formatDate(row.startedAt, now)}
                scoped={isScoped}
                expanded={row.id === expandedRow?.id}
                detail={row.id === expandedRow?.id ? expandedDetail : null}
                familySize={familySize.get(row.id) ?? 1}
                family={row.id === expandedRow?.id ? expandedFamilyView : null}
                errors={row.id === expandedRow?.id ? expandedErrors : null}
                toggleHref={expandHref(row.id, expandedId, links)}
              />
            ))}
          </TableBody>

          <TableFooter>
            <TableRow>
              <TableCell colSpan={footerLabelColSpan(isScoped)} className="font-medium">
                {rows.length} conversation{rows.length === 1 ? "" : "s"}
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatTokens(total.tokens.total)}</TableCell>
              <TableCell className="text-right font-semibold text-cost tabular-nums">
                {total.hasUnpriced ? (
                  <span title="Includes unpriced model usage — this total is a lower bound.">
                    {"~"}
                    {formatGrandTotalCost(total.costUsd)}
                  </span>
                ) : (
                  formatGrandTotalCost(total.costUsd)
                )}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </>
  );
}

function ListControls({ folder, links }: { folder: FolderEntry | undefined; links: ListLinkContext }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      {folder ? <FolderBreadcrumb folder={folder} links={links} /> : <span />}
      <ErrorsFilterToggle links={links} />
    </div>
  );
}

function ErrorsFilterToggle({ links }: { links: ListLinkContext }) {
  const active = links.errorsOnly === true;
  return (
    <Link
      href={errorsHref(links)}
      scroll={false}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
        active
          ? "border-destructive/30 bg-destructive/10 text-destructive dark:bg-destructive/20"
          : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      <AlertTriangle className="size-3.5" aria-hidden />
      Only with errors
    </Link>
  );
}

function EmptyState({ scoped, links }: { scoped: boolean; links: ListLinkContext }) {
  return (
    <div className="rounded-xl border border-dashed bg-card p-16 text-center">
      {links.errorsOnly ? (
        <>
          <p className="text-sm text-muted-foreground">
            No conversations with API errors{scoped ? " in this folder" : ""}.
          </p>
          <Link href={errorsHref(links)} className="mt-3 inline-block text-sm font-medium hover:underline">
            Show all conversations
          </Link>
        </>
      ) : scoped ? (
        <>
          <p className="text-sm text-muted-foreground">No conversations in this folder.</p>
          <Link href={folderHref(undefined, links)} className="mt-3 inline-block text-sm font-medium hover:underline">
            Clear filter — show all folders
          </Link>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">No conversations yet. Click Refresh to scan your conversations.</p>
      )}
    </div>
  );
}

function FolderBreadcrumb({ folder, links }: { folder: FolderEntry; links: ListLinkContext }) {
  return (
    <nav aria-label="Folder scope" className="flex flex-wrap items-center gap-2 text-sm">
      <Link href={folderHref(undefined, links)} className="text-muted-foreground hover:underline">
        All folders
      </Link>
      <span aria-hidden className="text-muted-foreground">
        /
      </span>
      <span className="font-medium" title={folder.path}>
        {folder.label}
      </span>
    </nav>
  );
}

function SortableHead({
  field,
  links,
  className,
  children,
}: {
  field: SortableField;
  links: ListLinkContext;
  className?: string;
  children: React.ReactNode;
}) {
  const sort = links.sort;
  const indicator = sortIndicator(field, sort);
  const isActive = sort.sortBy === field;
  const ariaSort = isActive ? (sort.dir === "asc" ? "ascending" : "descending") : "none";
  return (
    <TableHead className={className} aria-sort={ariaSort}>
      <Link
        href={sortHref(field, links)}
        className={`inline-flex items-center gap-1 text-xs font-medium tracking-wide uppercase transition-colors hover:text-foreground ${
          isActive ? "text-foreground" : "text-muted-foreground"
        }`}
      >
        {children}
        {indicator !== "" && <span aria-hidden>{indicator}</span>}
      </Link>
    </TableHead>
  );
}
