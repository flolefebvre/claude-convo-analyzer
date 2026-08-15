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

function MemberLink({ member }: { member: FamilyMember }) {
  return (
    <Link href={agentHref(member.id)} title={member.id}>
      {member.title ?? member.id}
    </Link>
  );
}
