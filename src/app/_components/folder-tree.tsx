"use client";

// The sidebar's folder tree (GLOSSARY.md, **Folder**). Each row is two
// targets: the chevron only opens or closes the Folder — no navigation — and
// the name only selects it as the scope, never toggling it. Folders start
// closed except the roots (one level) and the path down to the active scope,
// which a later scope change opens too (never closing anything); the open
// state lives in this component alone and is not remembered between visits.
//
// A client component because both the open state and the active scope come
// from the browser: the shell layout cannot read `searchParams`, so the
// initially-open path is decided here from `useSearchParams`, like the active
// highlight in `SidebarLink`.
//
// ADR-0002 boundary: no core import — the tree arrives already derived and
// serialized as props.

import { ChevronRight } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useId, useState } from "react";

import { FolderRow } from "@/app/_components/folder-rows";
import { SidebarLink } from "@/app/_components/sidebar-link";
import { resolveLiveFolderScope } from "@/app/_lib/folder-scope";
import { type FolderNode, initiallyOpenFolderPaths, openPathsDownToScope } from "@/app/_lib/folder-tree";

/**
 * The folder tree's rows, below the "All folders" anchor.
 *
 * @example <FolderTree roots={folderTree} totalCostUsd={totals.costUsd} />
 */
export function FolderTree({
  roots,
  totalCostUsd,
}: {
  roots: FolderNode[];
  /** The spend across every Project: every cost bar, at any depth, is a share of it. */
  totalCostUsd: number;
}) {
  const scope = resolveLiveFolderScope(useSearchParams());
  const scopeKey = `${scope.folder ?? ""}|${scope.thisFolderOnly}`;
  const [openPaths, setOpenPaths] = useState(() => initiallyOpenFolderPaths(roots, scope));
  // The tree outlives navigation (it sits in the shell layout), so a scope
  // reached from elsewhere — Back included — opens its path too, during render.
  const [openedForScopeKey, setOpenedForScopeKey] = useState(scopeKey);
  if (openedForScopeKey !== scopeKey) {
    setOpenedForScopeKey(scopeKey);
    setOpenPaths(openPathsDownToScope(openPaths, roots, scope));
  }
  const toggle = (path: string) =>
    setOpenPaths((current) => {
      const next = new Set(current);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  return <FolderList nodes={roots} openPaths={openPaths} toggle={toggle} totalCostUsd={totalCostUsd} />;
}

/** What every level of the tree shares: the open Folders, their toggle, and the bars' scale. */
type TreeState = {
  openPaths: Set<string>;
  toggle: (path: string) => void;
  totalCostUsd: number;
};

/** One level of the tree. */
function FolderList({ nodes, ...tree }: TreeState & { nodes: FolderNode[] }) {
  return (
    <ul className="flex flex-col gap-1">
      {nodes.map((node) => (
        <FolderItem key={node.path} node={node} {...tree} />
      ))}
    </ul>
  );
}

/**
 * A Folder's row and, when open, its sub-Folders — its "(this folder)" row
 * first when it has Conversations of its own.
 */
function FolderItem({ node, ...tree }: TreeState & { node: FolderNode }) {
  const childrenId = useId();
  const hasSubFolders = node.children.length > 0;
  const isOpen = hasSubFolders && tree.openPaths.has(node.path);
  return (
    <li>
      <div className="flex items-start">
        {hasSubFolders ? (
          <button
            type="button"
            aria-expanded={isOpen}
            aria-controls={isOpen ? childrenId : undefined}
            aria-label={`${node.label} sub-folders`}
            onClick={() => tree.toggle(node.path)}
            className="group/chevron mt-2 grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-expanded:text-foreground"
          >
            <ChevronRight
              className="size-4 transition-transform duration-150 group-aria-expanded/chevron:rotate-90"
              aria-hidden
            />
          </button>
        ) : (
          <span aria-hidden className="w-6 shrink-0" />
        )}
        <SidebarLink scope={{ folder: node.path }} title={node.path} className="min-w-0 flex-1">
          <FolderRow label={node.label} totals={node} totalCostUsd={tree.totalCostUsd} />
        </SidebarLink>
      </div>
      {isOpen && (
        <div id={childrenId} className="mt-1 ml-3">
          {node.thisFolder && (
            <div className="mb-1 flex items-start">
              <span aria-hidden className="w-6 shrink-0" />
              <SidebarLink
                scope={{ folder: node.path, thisFolderOnly: true }}
                title={`${node.path}, its own conversations only`}
                className="min-w-0 flex-1"
              >
                <FolderRow label="(this folder)" totals={node.thisFolder} totalCostUsd={tree.totalCostUsd} />
              </SidebarLink>
            </div>
          )}
          <FolderList nodes={node.children} {...tree} />
        </div>
      )}
    </li>
  );
}
