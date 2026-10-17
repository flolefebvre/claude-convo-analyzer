---
name: update-pricing
description: Refresh the Anthropic price table in src/core/pricing.ts with current list prices and any new models seen in the Claude Code logs. Use when asked to update pricing or add a model's prices, or when a model shows as "unpriced" in the UI.
---

# Update the price table

Prices live in one hardcoded, versioned table, `PRICES` in `src/core/pricing.ts`. Cost is computed at query time, so editing it reprices every conversation. Policy is ADR-0003: current public API list price, never batch, fast-mode or subscription rates.

1. **Get prices.** WebFetch `https://platform.claude.com/docs/en/about-claude/pricing` (base input/output per MTok, and any per-model cache-read rate) and the prompt-caching page for the multipliers: write 5m 1.25x, write 1h 2x, read 0.1x of input.
2. **Find missing models.** Rows are keyed by resolved model ids seen in the logs; add none speculatively.
   ```bash
   grep -rhoE '"claude-[a-z0-9-]+"' "${CCA_LOGS_ROOT:-$HOME/.claude/projects}" --include='*.jsonl' | sort | uniq -c | sort -rn | head -20
   ```
   Ignore non-model hits such as `"claude-code-guide"`.
3. **Red.** Add tests under `computeCost — known resolved models` in `src/core/__tests__/cost.test.ts`: 1M input and 1M output at list rate, plus the cache tiers when they're atypical. `pnpm test` must fail.
4. **Green.** In `src/core/pricing.ts`:
   - add the row with `priceRow(input, output)`, or `priceRow(input, output, cacheReadMultiplier)` when its cache read isn't 0.1x;
   - point `ALIAS_TO_LATEST` (`opus` / `sonnet` / `haiku`) at the family's newest key;
   - update the `SOURCE & DATE` comment and set `PRICE TABLE VERSION` to `<today>.1` (bump `.N` on the same day).
5. **Done** when `pnpm gate` ends with `--gate OK--`.
