// The order a Transcript shows an Agent's messages in, shared by every read
// that asks which message comes before another — so a "previous Turn" means
// the same thing wherever it is looked up. Framework-free (ADR-0002).

import type { Prisma } from "@/core/prisma/generated/client";

/**
 * The transcript order: timestamp, then id; SQLite sorts null timestamps first.
 *
 * @example
 * const messages = await prisma.message.findMany({ where: { agentId }, orderBy: TRANSCRIPT_ORDER });
 */
export const TRANSCRIPT_ORDER: Prisma.MessageOrderByWithRelationInput[] = [{ timestamp: "asc" }, { id: "asc" }];

/**
 * {@link TRANSCRIPT_ORDER} reversed, latest first: what finds the latest message
 * {@link orderedBefore} another.
 *
 * @example
 * const latestEarlier = await prisma.message.findFirst({ where: orderedBefore(message), orderBy: REVERSE_TRANSCRIPT_ORDER });
 */
export const REVERSE_TRANSCRIPT_ORDER: Prisma.MessageOrderByWithRelationInput[] = [
  { timestamp: "desc" },
  { id: "desc" },
];

/**
 * The messages that come before `row` in {@link TRANSCRIPT_ORDER}. An undated
 * row follows only the undated rows logged before it; a dated one follows
 * every undated row, every earlier timestamp, and its own timestamp's
 * earlier-logged rows.
 *
 * @example
 * const earlierCount = await prisma.message.count({ where: { AND: [{ agentId }, orderedBefore(message)] } });
 */
export function orderedBefore(row: { id: number; timestamp: bigint | null }): Prisma.MessageWhereInput {
  if (row.timestamp === null) return { timestamp: null, id: { lt: row.id } };
  return {
    OR: [{ timestamp: null }, { timestamp: { lt: row.timestamp } }, { timestamp: row.timestamp, id: { lt: row.id } }],
  };
}

/**
 * The messages that come after `row` in {@link TRANSCRIPT_ORDER}: every
 * message neither {@link orderedBefore} it nor `row` itself.
 *
 * @example
 * const next = await prisma.message.findFirst({ where: { AND: [{ agentId }, orderedAfter(message)] }, orderBy: TRANSCRIPT_ORDER });
 */
export function orderedAfter(row: { id: number; timestamp: bigint | null }): Prisma.MessageWhereInput {
  if (row.timestamp === null) return { OR: [{ timestamp: { not: null } }, { timestamp: null, id: { gt: row.id } }] };
  return { OR: [{ timestamp: { gt: row.timestamp } }, { timestamp: row.timestamp, id: { gt: row.id } }] };
}
