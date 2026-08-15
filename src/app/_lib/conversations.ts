import { cache } from "react";
import { connection } from "next/server";

import { getConversationErrors } from "@/core/errors";
import { buildFamily, familySizes } from "@/core/family";
import { getConversation, getDailySpend, getTranscript, listConversations } from "@/core/read";
import { searchConversations } from "@/core/search";
import { getToolCallSamples, getToolStats } from "@/core/tool-stats";

export const loadConversations = cache(async () => {
  await connection();
  return listConversations();
});

export const loadConversationDetail = cache(async (id: string) => {
  await connection();
  return getConversation(id);
});

export const loadConversationErrors = cache(async (id: string) => {
  await connection();
  return getConversationErrors(id);
});

export const loadFamilySizes = cache(async () => familySizes(await loadConversations()));

export const loadFamily = cache(async (id: string) => buildFamily(await loadConversations(), id));

export const loadDailySpend = cache(async (folder?: string, days?: number) => {
  await connection();
  return getDailySpend({ folder, days });
});

export const loadTranscript = cache(async (id: string, agentId?: string) => {
  await connection();
  return getTranscript(id, { agentId });
});

export const loadToolStats = cache(async (folder?: string, days?: number) => {
  await connection();
  return getToolStats({ folder, days });
});

export const loadSearch = cache(async (query: string) => {
  await connection();
  return searchConversations(query);
});

export const loadToolCallSamples = cache(async (name: string, folder?: string, days?: number) => {
  await connection();
  return getToolCallSamples(name, { folder, days });
});
