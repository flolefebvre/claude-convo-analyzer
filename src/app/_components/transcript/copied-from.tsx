// The marker of a Copied Message (GLOSSARY.md): history this Agent holds and
// another one owns. It takes the place a Turn's cost has on an owned row, so a
// row shows either what it cost or whose history it is.

import { PendingLink } from "@/app/_components/pending-link";
import { type AgentLabel } from "@/app/_lib/transcript";
import { agentSectionHref, messageHref, withListReturn } from "@/app/_lib/transcript-url";
import type { CopiedMessageOwner } from "@/core/read";

import { agentLabelText } from "./transcript-parts";

/**
 * "copied from <owner>" on a Copied Message, the owner a link to its Transcript at
 * that Message: named by its Agent when it is in this Conversation (the
 * spawner a fork copied), by its Conversation's title otherwise (the parent a
 * continuation copied). In the Conversation export an owner of this
 * Conversation links to its section of the file, and another Conversation's
 * reads as plain text.
 *
 * @example <CopiedFrom owner={message.copiedFrom} sessionId={view.sessionId} rootAgentId={view.tree.id} labels={labels} />
 */
export function CopiedFrom({
  owner,
  sessionId,
  rootAgentId,
  labels,
  listReturn,
  agentLinksAreInFile = false,
}: {
  owner: CopiedMessageOwner;
  /** The session of the Transcript showing the copy. */
  sessionId: string;
  /** The main agent's tree key: an owner that is this Conversation's Main thread names no agent. */
  rootAgentId: string;
  /** Every agent's display name, from `agentLabels(view.tree)`. */
  labels: Map<string, AgentLabel>;
  /** The list view this transcript was opened from (`?from=`), carried on the link. */
  listReturn?: string;
  /** True in the Conversation export: no route leaves the file. */
  agentLinksAreInFile?: boolean;
}) {
  const isOwnerInThisConversation = owner.sessionId === sessionId;
  const ownerAgentId = owner.agentId ?? rootAgentId;
  const ownerAgentLabel = labels.get(ownerAgentId);
  const name =
    isOwnerInThisConversation && ownerAgentLabel !== undefined
      ? agentLabelText(ownerAgentLabel)
      : (owner.title ?? owner.sessionId);
  const title = isOwnerInThisConversation ? `Copied from ${name}` : `Copied from ${owner.sessionId}`;

  let ownerLink;
  if (!agentLinksAreInFile) {
    ownerLink = (
      <PendingLink
        href={withListReturn(messageHref(owner.sessionId, owner.agentId ?? undefined, owner.messageUuid), listReturn)}
      >
        {name}
      </PendingLink>
    );
  } else if (isOwnerInThisConversation) {
    ownerLink = <a href={agentSectionHref(ownerAgentId)}>{name}</a>;
  } else {
    ownerLink = <span>{name}</span>;
  }
  return (
    <span className="copied-from" title={title}>
      copied from {ownerLink}
    </span>
  );
}
