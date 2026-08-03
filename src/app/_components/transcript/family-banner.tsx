// The continuation banner of the Transcript view (issue #46): one compact line
// naming the conversation this session was resumed from and the sessions that
// continue it — DIRECT parent and DIRECT children only. The full family tree
// stays in the list's detail panel; here it is just lineage you can step
// through, each name linking to that conversation's own transcript.
//
// Renders nothing for a standalone conversation, so the reading surface is
// untouched unless the lineage actually exists.

import Link from "next/link";

import { agentHref } from "@/app/_lib/transcript-url";
import type { FamilyMember } from "@/core/family";

export function FamilyBanner({
  parent,
  continuations,
}: {
  parent: FamilyMember | null;
  continuations: FamilyMember[];
}) {
  if (parent === null && continuations.length === 0) return null;

  return (
    <div className="family-banner">
      {parent && (
        <span>
          Continued from <MemberLink member={parent} />
        </span>
      )}
      {continuations.length > 0 && (
        <span>
          Continues in{" "}
          {continuations.map((child, i) => (
            <span key={child.id}>
              {i > 0 && ", "}
              <MemberLink member={child} />
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

/** A family member as a link into its own transcript (main agent). */
function MemberLink({ member }: { member: FamilyMember }) {
  return (
    <Link href={agentHref(member.id)} title={member.id}>
      {member.title ?? member.id}
    </Link>
  );
}
