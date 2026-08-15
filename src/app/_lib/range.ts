import { firstParam } from "@/app/_lib/search-params";

export type RangeKey = "7" | "30" | "90" | "all";

export const RANGE_PRESETS = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "all", label: "All time" },
] as const satisfies readonly { value: RangeKey; label: string }[];

export const DEFAULT_RANGE: RangeKey = "30";

export function resolveRange(raw: string | string[] | undefined): RangeKey {
  const value = firstParam(raw);
  const preset = RANGE_PRESETS.find((p) => p.value === value);
  return preset === undefined ? DEFAULT_RANGE : preset.value;
}

export function rangeDays(range: RangeKey): number | undefined {
  return range === "all" ? undefined : Number(range);
}

export function rangeHref(range: RangeKey, folder?: string): string {
  const params = new URLSearchParams({ range });
  if (folder) params.set("folder", folder);
  return `?${params.toString()}`;
}
