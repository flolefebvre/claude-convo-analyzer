import { readClient } from "@/core/db";

export type ConversationApiError = {
  agentId: string;
  agentType: string | null;
  messageUuid: string | null;
  timestamp: string;
  status: string | null;
  excerpt: string;
};

const EXCERPT_CHARS = 160;

export type ConversationErrorsOptions = {
  dbPath?: string;
};

export async function getConversationErrors(
  sessionId: string,
  opts: ConversationErrorsOptions = {},
): Promise<ConversationApiError[]> {
  const { prisma, owned } = readClient(opts.dbPath);
  try {
    const rows = await prisma.message.findMany({
      where: { isApiError: true, conversation: { sessionId } },
      orderBy: [{ id: "asc" }],
      select: {
        uuid: true,
        timestamp: true,
        text: true,
        apiErrorMessage: true,
        agent: { select: { id: true, externalAgentId: true, agentType: true } },
      },
    });
    return rows.map(toApiError).sort(byMomentThenOrder);
  } finally {
    if (owned) await prisma.$disconnect();
  }
}

function byMomentThenOrder(a: ConversationApiError, b: ConversationApiError): number {
  if (a.timestamp === b.timestamp) return 0;
  if (a.timestamp === "") return 1;
  if (b.timestamp === "") return -1;
  return a.timestamp < b.timestamp ? -1 : 1;
}

type ErrorRow = {
  uuid: string | null;
  timestamp: bigint | number | null;
  text: string | null;
  apiErrorMessage: string | null;
  agent: { id: number; externalAgentId: string | null; agentType: string | null };
};

function toApiError(row: ErrorRow): ConversationApiError {
  return {
    agentId: row.agent.externalAgentId ?? String(row.agent.id),
    agentType: row.agent.agentType,
    messageUuid: row.uuid,
    timestamp: row.timestamp == null ? "" : new Date(Number(row.timestamp)).toISOString(),
    status: row.apiErrorMessage,
    excerpt: (row.text ?? "").slice(0, EXCERPT_CHARS),
  };
}
