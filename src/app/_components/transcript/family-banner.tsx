// The continuation banner of the Transcript view (issue #46): one compact line
// naming the conversation this session was resumed from and the sessions that
// continue it — DIRECT parent and DIRECT children only. The full family tree
// stays in the list's detail panel; here it is just lineage you can step
// through, each name linking to that conversation's own transcript.
//
// Renders nothing for a standalone conversation, so the reading surface is
// untouched unless the lineage actually exists.

import Link from "next/link";

import { agentHref, withListReturn } from "@/app/_lib/transcript-url";
import type { FamilyMember } from "@/core/family";

/**
 * The continuation lineage above the main agent's transcript: where this
 * sitting was resumed from and the sittings that continue it, each a link.
 *
 * @example <FamilyBanner parent={family.parent} continuations={family.children} />
 */
export function FamilyBanner({
  parent,
  continuations,
  listReturn,
  linksAreText = false,
}: {
  parent: FamilyMember | null;
  continuations: FamilyMember[];
  /** The list view this transcript was opened from (`?from=`), carried on
   *  every link to another transcript. */
  listReturn?: string;
  /** True in the Conversation export: each member is named as plain text. */
  linksAreText?: boolean;
}) {
  if (parent === null && continuations.length === 0) return null;

  return (
    <div className="family-banner">
      {parent && (
        <p>
          <span className="family-lead">Continued from</span>
          <MemberLink member={parent} listReturn={listReturn} linksAreText={linksAreText} />
        </p>
      )}
      {continuations.length > 0 && (
        <div className="family-row">
          <span className="family-lead">Continues in</span>
          {/* One item per sitting: titles carry their own dashes and commas,
              so a comma-joined run would blur where one ends. */}
          <ul>
            {continuations.map((child) => (
              <li key={child.id}>
                <MemberLink member={child} listReturn={listReturn} linksAreText={linksAreText} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** A family member as a link into its own transcript (main agent), or its plain name. */
function MemberLink({
  member,
  listReturn,
  linksAreText,
}: {
  member: FamilyMember;
  listReturn: string | undefined;
  linksAreText: boolean;
}) {
  if (linksAreText) return <span title={member.id}>{member.title ?? member.id}</span>;
  return (
    <Link href={withListReturn(agentHref(member.id), listReturn)} title={member.id}>
      {member.title ?? member.id}
    </Link>
  );
}
