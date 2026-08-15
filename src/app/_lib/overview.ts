import type { Tokens } from "@/core/cost";

export type Overview = {
  conversationCount: number;
  projectCount: number;
  totalCost: number;
  hasUnpriced: boolean;
  tokens: Tokens;
  cacheReadRatio: number;
  earliest: string;
  latest: string;
};
