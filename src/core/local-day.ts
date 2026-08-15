export function startOfLocalDay(epochMs: number): Date {
  const d = new Date(epochMs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addLocalDays(day: Date, n: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + n);
}

export function localDayKey(day: Date): string {
  const month = String(day.getMonth() + 1).padStart(2, "0");
  const date = String(day.getDate()).padStart(2, "0");
  return `${day.getFullYear()}-${month}-${date}`;
}
