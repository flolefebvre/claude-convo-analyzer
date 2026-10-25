// A row of the Transcript's Rail spoken by one speaker: the avatar in the
// speaker gutter, then the row's head and its bubble. Speakers differ by shape
// and icon as well as colour, so none is told apart by colour alone.

import { Asterisk, Bot, Link as LinkIcon, User } from "lucide-react";
import type { ReactNode } from "react";

import { type MessageAnchor, RowHead, labelledBy } from "./transcript-parts";

/** Who speaks in a Transcript row: the person, the Agent whose Transcript it is, another Agent of this Conversation, or another Conversation's agent. */
export type Speaker = "person" | "assistant" | "agent" | "other-conversation";

const ICON_BY_SPEAKER = { person: User, assistant: Asterisk, agent: Bot, "other-conversation": LinkIcon } as const;

/**
 * A row's 28 px avatar in the speaker gutter: round for the person and the
 * Agent itself, a rounded square for every other agent, outlined when it is
 * another Conversation's. Decorative: the row's header names the speaker.
 *
 * @example <SpeakerAvatar speaker="person" />
 */
export function SpeakerAvatar({ speaker }: { speaker: Speaker }) {
  const Icon = ICON_BY_SPEAKER[speaker];
  return (
    <span className={`avatar is-${speaker}`} aria-hidden>
      <Icon className="avatar-icon" />
    </span>
  );
}

/**
 * One Message addressed to the Agent, spoken: an `<article>` named by its
 * speaker and time, its avatar in the gutter, its head (`label`, the `notes`
 * after it, the time, then `trailing`), and its body in a bubble.
 *
 * @example <SpeakerRow speaker="person" label="You" className="row prompt" anchor={anchor} time={time} timestamp={message.timestamp}>{text}</SpeakerRow>
 */
export function SpeakerRow({
  speaker,
  label,
  className,
  anchor,
  time,
  timestamp,
  notes,
  trailing,
  children,
}: {
  speaker: Speaker;
  /** The speaker as its head names it ("You", "From Plan"). */
  label: ReactNode;
  className: string;
  anchor: MessageAnchor;
  time: string;
  timestamp: string | null;
  /** Notes after the speaker: a slash command's plugin, "sent while working", "hand-back". */
  notes?: ReactNode;
  /** After the time, at the head's right edge: the copied-from marker. */
  trailing?: ReactNode;
  /** The bubble's content. */
  children: ReactNode;
}) {
  return (
    <article id={anchor.id} className={className} aria-labelledby={labelledBy(anchor, time)}>
      <div className="gutter">
        <SpeakerAvatar speaker={speaker} />
      </div>
      <div className="row-main">
        <RowHead
          speaker={label}
          speakerClass="speaker"
          time={time}
          timestamp={timestamp}
          labelId={anchor.labelId}
          trailing={trailing}
        >
          {notes}
        </RowHead>
        <div className="bubble">{children}</div>
      </div>
    </article>
  );
}
