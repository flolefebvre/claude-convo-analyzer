"use server";

import { actionPipe } from "@flefebvre/next-pipe/pipes";
import { success } from "@flefebvre/next-pipe/server";
import { revalidatePath } from "next/cache";
import { connection } from "next/server";

import { refresh } from "@/core/refresh";

export const refreshConversations = actionPipe().handle(async () => {
  await connection();
  const summary = await refresh();
  revalidatePath("/", "layout");
  return success(summary);
});
