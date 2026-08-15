import { firstParam } from "@/app/_lib/search-params";

export function resolveAgent(raw: string | string[] | undefined): string | undefined {
  return firstParam(raw) || undefined;
}

export function agentHref(sessionId: string, agentId?: string): string {
  const base = `/conversation/${encodeURIComponent(sessionId)}`;
  if (!agentId) return base;
  return `${base}?${new URLSearchParams({ agent: agentId }).toString()}`;
}

export function resolveCall(raw: string | string[] | undefined): string | undefined {
  return firstParam(raw) || undefined;
}

export function callAnchorId(toolUseId: string): string {
  return `call-${toolUseId}`;
}

export function resolveMessage(raw: string | string[] | undefined): string | undefined {
  return firstParam(raw) || undefined;
}

export function messageAnchorId(messageUuid: string): string {
  return `msg-${messageUuid}`;
}

export function messageHref(sessionId: string, agentId: string | undefined, messageUuid: string | null): string {
  const base = agentHref(sessionId, agentId);
  if (messageUuid === null) return base;
  const separator = base.includes("?") ? "&" : "?";
  const query = new URLSearchParams({ msg: messageUuid }).toString();
  return `${base}${separator}${query}#${encodeURIComponent(messageAnchorId(messageUuid))}`;
}

export function toolCallHref(sessionId: string, agentId: string | undefined, toolUseId: string | null): string {
  const base = agentHref(sessionId, agentId);
  if (toolUseId === null) return base;
  const separator = base.includes("?") ? "&" : "?";
  const query = new URLSearchParams({ call: toolUseId }).toString();
  return `${base}${separator}${query}#${callAnchorId(toolUseId)}`;
}
