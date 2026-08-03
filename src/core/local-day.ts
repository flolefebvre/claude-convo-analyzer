// Local calendar-day arithmetic, shared by every date-scoped read (Trends'
// `getDailySpend`, Tools' `getToolStats`). Days are LOCAL, never UTC: a range of
// N days ends on today's local day and counts back N-1 days, and an instant is
// bucketed into the local day it falls on — so the numbers match the day the
// user remembers working.

/** Local midnight of the day an instant falls on. */
export function startOfLocalDay(epochMs: number): Date {
  const d = new Date(epochMs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** `n` local days after `day` — via the Date constructor, so DST shifts are handled. */
export function addLocalDays(day: Date, n: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + n);
}

/** A local day as its `YYYY-MM-DD` key (the axis label and bucket key). */
export function localDayKey(day: Date): string {
  const month = String(day.getMonth() + 1).padStart(2, "0");
  const date = String(day.getDate()).padStart(2, "0");
  return `${day.getFullYear()}-${month}-${date}`;
}
