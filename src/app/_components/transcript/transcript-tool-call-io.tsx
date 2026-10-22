// A loaded Tool call body's markup — its input and result blocks, their
// rendered parts and the truncation note — shared by the live Transcript's
// client disclosure and the Conversation export's server one. No state and no
// directive, so it renders on either side; each caller decides how a block
// shows its raw text (a button in the app, a nested <details> in the export).

import { Scissors } from "lucide-react";
import { type ComponentType, type ReactNode, useId } from "react";

import {
  prettyToolText,
  type ToolCallBody,
  toolCallFactText,
  type ToolCallPart,
  truncationNote,
} from "@/app/_lib/transcript";

import { TurnMarkdown } from "./turn-markdown";

/** What one input or result block shows. */
export type IoBlockProps = {
  label: string;
  /** The block's stored text — what a raw part, and the block's raw view, show. */
  text: string;
  parts: ToolCallPart[];
  isError?: boolean;
  children?: ReactNode;
};

/** The pieces of a rendered block, for its caller to lay out with a way to its raw text. */
export type IoBlockViews = { labelView: ReactNode; rawView: ReactNode; partsView: ReactNode };

/**
 * A Tool call body's two blocks — its input, then its result with the
 * truncation note when the stored result was cut — each drawn by `IoBlock`.
 *
 * @example <ToolCallBodyBlocks body={body} labels={{ input: "Input", result: "Result" }} IoBlock={LiveIoBlock} />
 */
export function ToolCallBodyBlocks({
  body,
  labels,
  IoBlock,
}: {
  body: ToolCallBody;
  /** The input and result block labels ("Input"/"Result", or "Prompt"/"Returned" for an Agent call). */
  labels: { input: string; result: string };
  IoBlock: ComponentType<IoBlockProps>;
}) {
  const note = truncationNote(body);
  return (
    <>
      <IoBlock label={labels.input} text={body.inputJson} parts={body.inputParts} />
      {body.resultText !== null && (
        <IoBlock label={labels.result} text={body.resultText} parts={body.resultParts ?? []} isError={body.isError}>
          {note && (
            <div className="trunc">
              <Scissors aria-hidden className="size-3" />
              Truncated: {note}
            </div>
          )}
        </IoBlock>
      )}
    </>
  );
}

/**
 * One labelled input/result block, height-capped: its stored `text` (JSON
 * pretty-printed) when its only part is raw, else its rendered `parts`, laid
 * out with a way back to that text by `layOutViews`.
 *
 * @example <IoBlockFrame {...props} layOutViews={({ labelView, partsView }) => <>{labelView}{partsView}</>} />
 */
export function IoBlockFrame({
  label,
  text,
  parts,
  isError = false,
  children,
  layOutViews,
}: IoBlockProps & { layOutViews: (views: IoBlockViews) => ReactNode }) {
  const labelId = useId();
  const labelView = (
    <span id={labelId} className="io-label">
      {label}
    </span>
  );
  const rawView = <pre className={isError ? "err" : undefined}>{prettyToolText(text)}</pre>;
  const isRawOnly = parts.every((part) => part.kind === "raw");
  return (
    <div role="group" aria-labelledby={labelId} className="io-block">
      {isRawOnly ? (
        <>
          {labelView}
          {rawView}
        </>
      ) : (
        layOutViews({
          labelView,
          rawView,
          partsView: (
            <div className="io-view">
              {parts.map((part, index) => (
                <BodyPart key={index} part={part} text={text} />
              ))}
            </div>
          ),
        })
      )}
      {children}
    </div>
  );
}

/** One rendered part of a block; a raw part shows the block's stored `text`. */
function BodyPart({ part, text }: { part: ToolCallPart; text: string }) {
  switch (part.kind) {
    case "facts":
      return (
        <dl className="io-facts">
          {part.facts.map((fact) => (
            <div key={fact.key}>
              <dt>{fact.key}</dt>
              <dd>{toolCallFactText(fact)}</dd>
            </div>
          ))}
        </dl>
      );
    case "markdown":
      return (
        <div className="turn-body">
          <TurnMarkdown text={part.text} />
        </div>
      );
    case "raw":
      return <pre className="io-raw-part">{prettyToolText(text)}</pre>;
  }
}
