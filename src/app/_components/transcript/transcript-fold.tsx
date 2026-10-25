"use client";

// A fold line of the Transcript filter (GLOSSARY.md): a dashed line saying
// what the filter hid at this spot. The hidden content arrives rendered, as
// `children`, but enters the page only once the reader reveals it, so a
// Transcript loads with no flash of it; the same line, then solid, hides it
// again.

import { type ReactNode, useId, useState } from "react";

/**
 * The line standing in for hidden content, `label hidden · show`, and, once
 * revealed, that content under it, the line reading `label · hide`. A `row`
 * fold stands in for a whole row of the Transcript (an Inter-agent message, a
 * Task notification), its line in the row's column; an `inline` one sits among
 * a Reply's Turns or inside a Turn. Key it on the Transcript filter, so a new
 * filter starts every fold hidden.
 *
 * @example <TranscriptFold key={filterKey} label="3 tool calls" layout="inline" isInitiallyRevealed={false}>{calls}</TranscriptFold>
 */
export function TranscriptFold({
  label,
  layout,
  isInitiallyRevealed,
  children,
}: {
  /** What the fold holds: "3 tool calls", "Task notification". */
  label: string;
  layout: "row" | "inline";
  /** True when it holds the page's `?call=`/`?msg=` target. */
  isInitiallyRevealed: boolean;
  children: ReactNode;
}) {
  const [isRevealed, setIsRevealed] = useState(isInitiallyRevealed);
  const contentId = useId();
  const line = (
    <button
      type="button"
      className="fold"
      aria-expanded={isRevealed}
      aria-controls={isRevealed ? contentId : undefined}
      onClick={() => setIsRevealed(!isRevealed)}
    >
      {label}
      {isRevealed ? " · hide" : " hidden · show"}
    </button>
  );
  return (
    <>
      {layout === "row" ? (
        <div className="row fold-row">
          <div className="gutter" />
          <div className="row-main">{line}</div>
        </div>
      ) : (
        line
      )}
      {isRevealed && (
        <div id={contentId} className="fold-content">
          {children}
        </div>
      )}
    </>
  );
}
