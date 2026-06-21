# Cost model and pricing policy

## Status

accepted

## Context

A core feature is showing what each conversation *would have cost on the Claude
API*. This is a hypothetical: the user runs on a flat-rate subscription, so
their real marginal cost is ~$0. The number's purpose is comparison/awareness,
not billing. Several judgement calls were needed about what price to apply and
to which models.

## Decision

- **Baseline = current Anthropic API list price.** Not the user's subscription
  economics, not blended/discounted rates. The displayed cost is "what these
  tokens would list for on the public API today."
- **Hardcoded, versioned price table** in `src/core` (no network). Per known
  model, **explicit USD/MTok rates per token type**: `input`, `output`,
  `cache_write_5m`, `cache_write_1h`, `cache_read`. Cache tiers are priced
  distinctly (kept separate in the DB), not derived by a shared multiplier, so a
  model with atypical cache pricing stays correct. The table carries the date
  and source it was taken from.
- **Model normalization.** Map alias strings to canonical models. Bare aliases
  (`opus`, `sonnet`) are priced at that family's latest rate and **flagged
  approximate**. `<synthetic>` and any unknown/unpriced model contribute **$0**
  but are **flagged as unpriced**, so a total is never silently wrong — the UI
  can show an "includes unpriced usage" marker.
- **Cost is computed in application code at query/display time**, never stored
  (see ADR-0001). Re-pricing (a table bump) requires no re-parse.

## Consequences

- Updating prices = editing one dated table + bumping its version comment; all
  historical conversations reprice instantly.
- Costs are reproducible and deterministic (no live pricing dependency).
- Because unpriced usage is flagged rather than dropped, the UI must surface the
  flag so users don't mistake a partial total for a complete one.
- Token *counts* are always exact and unaffected by pricing gaps; only the
  dollar figure is subject to the unpriced-model caveat.
