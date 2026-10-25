"use client";

// The Show section of the agent tree: the Transcript filter (GLOSSARY.md). A
// toggle flips at once and saves the choice through the `setTranscriptFilter`
// server action (ADR-0002: no core import from a client file), then re-renders
// the page at the same URL, so the server renders the Transcript under the new
// filter: no navigation, the same Transcript page. A save that failed flips it
// back and says why.

import { Check, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useOptimistic, useState, useTransition } from "react";

import {
  TRANSCRIPT_FILTER_EVERYTHING,
  TRANSCRIPT_FILTER_KINDS,
  TRANSCRIPT_FILTER_MESSAGES_ONLY,
  type TranscriptFilter,
  isSameTranscriptFilter,
} from "@/app/_lib/transcript-filter";
import { formatCount } from "@/app/_lib/format";
import { setTranscriptFilter } from "@/app/actions";

/** Each kind's toggle label, the glossary's name for it. */
const KIND_LABEL: Record<keyof TranscriptFilter, string> = {
  toolCalls: "Tool calls",
  thinking: "Thinking",
  whatWasSent: "What was sent",
  interAgentMessages: "Inter-agent messages",
  taskNotifications: "Task notifications",
};

/**
 * The Show section, below the Conversation total: one toggle per kind of
 * content, each with its count across the selected Agent's whole Transcript,
 * then the Messages only and Everything shortcuts. On a narrow screen it folds
 * away under its own caption.
 *
 * @example <TranscriptFilterSection filter={filter} countByKind={{ toolCalls: 12, thinking: 3, whatWasSent: 0, interAgentMessages: 1, taskNotifications: 2 }} />
 */
export function TranscriptFilterSection({
  filter,
  countByKind,
}: {
  /** The filter as the server read it from the settings file. */
  filter: TranscriptFilter;
  /** How many of each kind the selected Agent's whole Transcript holds. */
  countByKind: Record<keyof TranscriptFilter, number>;
}) {
  const router = useRouter();
  const [shownFilter, showFilter] = useOptimistic(filter);
  const [, startTransition] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);
  const [isOpenOnNarrowScreen, setIsOpenOnNarrowScreen] = useState(false);
  const bodyId = useId();

  function choose(chosen: TranscriptFilter) {
    setFailure(null);
    // The pressed state holds until the re-rendered page lands: the action and
    // the refresh run in the transition that set it.
    startTransition(async () => {
      showFilter(chosen);
      try {
        const result = await setTranscriptFilter(chosen);
        if (result.status === "success") router.refresh();
        else
          setFailure(
            result.error.type === "transcriptFilterNotSaved" ? result.error.data.message : "The change was refused.",
          );
      } catch (cause) {
        setFailure(cause instanceof Error ? cause.message : String(cause));
      }
    });
  }

  return (
    <div className={isOpenOnNarrowScreen ? "show-section is-open" : "show-section"}>
      <div className="tree-caption show-caption" aria-hidden>
        Show
      </div>
      <button
        type="button"
        className="tree-caption show-disclosure"
        aria-expanded={isOpenOnNarrowScreen}
        aria-controls={bodyId}
        onClick={() => setIsOpenOnNarrowScreen(!isOpenOnNarrowScreen)}
      >
        <ChevronRight aria-hidden className="chev" />
        Show
      </button>
      <div id={bodyId} className="show-body">
        <div role="group" aria-label="Show in the transcript" className="show-toggles">
          {TRANSCRIPT_FILTER_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              className="show-toggle"
              aria-pressed={shownFilter[kind]}
              onClick={() => choose({ ...shownFilter, [kind]: !shownFilter[kind] })}
            >
              <span className="check" aria-hidden>
                <Check />
              </span>
              <span>{KIND_LABEL[kind]}</span>
              <span className="show-count">{formatCount(countByKind[kind])}</span>
            </button>
          ))}
        </div>
        <div className="show-presets">
          <button
            type="button"
            className="show-preset"
            aria-pressed={isSameTranscriptFilter(shownFilter, TRANSCRIPT_FILTER_MESSAGES_ONLY)}
            onClick={() => choose(TRANSCRIPT_FILTER_MESSAGES_ONLY)}
          >
            Messages only
          </button>
          <button
            type="button"
            className="show-preset"
            aria-pressed={isSameTranscriptFilter(shownFilter, TRANSCRIPT_FILTER_EVERYTHING)}
            onClick={() => choose(TRANSCRIPT_FILTER_EVERYTHING)}
          >
            Everything
          </button>
        </div>
        <p role="status" className="show-failure">
          {failure !== null && `The filter could not be saved: ${failure}`}
        </p>
      </div>
    </div>
  );
}
