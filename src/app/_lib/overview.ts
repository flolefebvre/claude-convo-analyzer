// The `Overview` type for the overview band (the analysis surface): the headline
// cost/token/count stats shown above the conversation table. The aggregation
// itself (`deriveOverview`) folded into the `buildListView` pipeline seam in
// `list-view.ts`; this type stays here because the `OverviewBand` component
// renders with it as a plain prop (ADR-0002: no core import in the component).
//
// Type-only module: the single core touch is a type-only import of `Tokens`,
// erased at compile time and so not crossing the ADR-0002 runtime boundary.

import type { Tokens } from "@/core/cost";

/** The headline analysis of a set of conversations, for the overview band. */
export type Overview = {
  /** Number of conversations summarized. */
  conversationCount: number;
  /** Number of distinct Projects the conversations belong to. */
  projectCount: number;
  /** Summed cost (USD); a lower bound when {@link hasUnpriced} is true. */
  totalCost: number;
  /** True when ANY conversation has unpriced usage (cost is a lower bound). */
  hasUnpriced: boolean;
  /** Summed tokens by bucket across all conversations. */
  tokens: Tokens;
  /** Share of total tokens served from cache reads, in `[0, 1]`. `0` when there
   *  are no tokens (no divide-by-zero). */
  cacheReadRatio: number;
  /** Earliest known `startedAt` across all rows, as an ISO string; `""` if none. */
  earliest: string;
  /** Latest activity (`endedAt`, falling back to `startedAt`); `""` if none. */
  latest: string;
};
