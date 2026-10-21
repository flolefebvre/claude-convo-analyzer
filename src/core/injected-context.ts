// Injected context (GLOSSARY.md): the pieces of it a sent message holds, each
// with its kind — the type of the `attachment` record whose rendered text it
// is (docs/conversation-log-format.md §9, "Attachments with `rendered` text").
// A piece is found by its text alone, within one log file. Framework-free
// (ADR-0002).

/** An attachment's `type` as logged: the kind of a piece of Injected context (`skill_listing`, `date`, …). */
export type AttachmentType = string;

/** One piece of Injected context in a sent message: the content block holding it, its span there, and its kind. */
export type InjectedContextPiece = {
  /** The index of its content block in the message; a string content is block 0. */
  blockIndex: number;
  /** Where it starts in the block's text, in UTF-16 code units. */
  start: number;
  /** Where it ends in the block's text, exclusive. */
  end: number;
  kind: AttachmentType;
  /** The files an `instructions` piece lists (`attachment.files[].path`), in order; absent on any other kind. */
  instructionFilePaths?: string[];
};

/** One text block of a sent message: its index among the message's content blocks, and its text. */
export type SentTextBlock = { blockIndex: number; text: string };

/** What a rendered text says of the piece it is: its kind, and the files of `instructions`. */
type InjectedContextSource = Pick<InjectedContextPiece, "kind" | "instructionFilePaths">;

/** The tags a rendered text is logged in, whatever role it is sent under. */
const SYSTEM_REMINDER_OPENING_TAG = "<system-reminder>";
const SYSTEM_REMINDER_CLOSING_TAG = "</system-reminder>";

/** `text` without its system-reminder tags and the whitespace around them: how a `system` piece is sent. */
function unwrappedText(text: string): string {
  let unwrapped = text.trim();
  if (unwrapped.startsWith(SYSTEM_REMINDER_OPENING_TAG))
    unwrapped = unwrapped.slice(SYSTEM_REMINDER_OPENING_TAG.length);
  if (unwrapped.endsWith(SYSTEM_REMINDER_CLOSING_TAG))
    unwrapped = unwrapped.slice(0, -SYSTEM_REMINDER_CLOSING_TAG.length);
  return unwrapped.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The source of an `attachment` record with `rendered` text and a `renderedRole` (2.1.285+); null for any other. */
function injectedContextSourceOf(record: Record<string, unknown>): InjectedContextSource | null {
  const attachment = record.attachment;
  if (typeof record.renderedRole !== "string" || !isRecord(attachment) || typeof attachment.type !== "string") {
    return null;
  }
  if (attachment.type !== "instructions") return { kind: attachment.type };
  const files = Array.isArray(attachment.files) ? attachment.files : [];
  const instructionFilePaths = files.flatMap((file) =>
    isRecord(file) && typeof file.path === "string" ? [file.path] : [],
  );
  return { kind: attachment.type, instructionFilePaths };
}

/**
 * The Injected context of one log file: each rendered text its attachment
 * records logged, by that text both as logged and unwrapped, so a text
 * matches whatever role it was sent under. Fed while the file is read, asked
 * once it is: an attachment may follow the message that sent it.
 *
 * @example
 * const injectedContext = injectedContextDictionary();
 * injectedContext.add(attachmentRecord);
 * const pieces = injectedContext.piecesOf([{ blockIndex: 0, text: "Today's date is 2026-10-21." }], "system");
 */
export function injectedContextDictionary() {
  const sourceByRenderedText = new Map<string, InjectedContextSource>();
  const keepFirst = (text: string, source: InjectedContextSource) => {
    if (text.trim() !== "" && !sourceByRenderedText.has(text)) sourceByRenderedText.set(text, source);
  };
  return {
    /** An `attachment` record: its rendered texts join the dictionary when it has a `renderedRole`. */
    add: (record: Record<string, unknown>): void => {
      if (!Array.isArray(record.rendered)) return;
      const source = injectedContextSourceOf(record);
      if (source === null) return;
      for (const rendered of record.rendered) {
        if (!isRecord(rendered) || typeof rendered.content !== "string") continue;
        keepFirst(rendered.content, source);
        keepFirst(unwrappedText(rendered.content), source);
      }
    },
    /**
     * The pieces of Injected context in `textBlocks` of a message from
     * `messageRole`, in order: a block equal to a rendered text is one piece,
     * whatever the role; any other block of a system message holds each
     * rendered text found in it, in order and not overlapping, the longest
     * where two start alike. A user's block is never split: one quoting an
     * injected text stays the person's own.
     */
    piecesOf: (textBlocks: SentTextBlock[], messageRole: string): InjectedContextPiece[] => {
      if (sourceByRenderedText.size === 0) return [];
      return textBlocks.flatMap(({ blockIndex, text }) => {
        const exactSource = sourceByRenderedText.get(text);
        if (exactSource !== undefined) return [{ blockIndex, start: 0, end: text.length, ...exactSource }];
        if (messageRole !== "system") return [];
        return matchesIn(text, sourceByRenderedText).map((match) => ({ blockIndex, ...match }));
      });
    },
  };
}

/** Every rendered text of `sourceByRenderedText` found in `text`, in order and not overlapping, the longest where two start alike. */
function matchesIn(
  text: string,
  sourceByRenderedText: Map<string, InjectedContextSource>,
): Omit<InjectedContextPiece, "blockIndex">[] {
  const candidates: Omit<InjectedContextPiece, "blockIndex">[] = [];
  for (const [renderedText, source] of sourceByRenderedText) {
    if (renderedText.length > text.length) continue;
    for (let start = text.indexOf(renderedText); start !== -1; start = text.indexOf(renderedText, start + 1)) {
      candidates.push({ start, end: start + renderedText.length, ...source });
    }
  }
  candidates.sort((a, b) => a.start - b.start || b.end - a.end);
  const matches: Omit<InjectedContextPiece, "blockIndex">[] = [];
  for (const candidate of candidates) {
    if (candidate.start >= (matches.at(-1)?.end ?? 0)) matches.push(candidate);
  }
  return matches;
}
