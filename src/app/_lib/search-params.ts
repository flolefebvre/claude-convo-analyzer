export type ViewSearchParams = {
  sortBy?: string | string[];
  dir?: string | string[];
  folder?: string | string[];
  expanded?: string | string[];
  range?: string | string[];
  errors?: string | string[];
};

export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
