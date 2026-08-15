export function formatTokens(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function formatCompactTokens(n: number): string {
  const abs = Math.abs(n);
  const units: { limit: number; suffix: string }[] = [
    { limit: 1e9, suffix: "B" },
    { limit: 1e6, suffix: "M" },
    { limit: 1e3, suffix: "K" },
  ];
  for (const { limit, suffix } of units) {
    if (abs >= limit) {
      const scaled = n / limit;
      return `${scaled.toFixed(1).replace(/\.0$/, "")}${suffix}`;
    }
  }
  return Math.round(n).toString();
}

export function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  const decimals = Math.abs(usd) >= 0.01 ? 2 : 4;
  return `$${usd.toFixed(decimals)}`;
}

export function formatGrandTotalCost(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

export function formatClock(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function formatDate(iso: string | null, now: Date = new Date()): { label: string; absolute: string } {
  if (!iso) return { label: "—", absolute: "" };
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { label: "—", absolute: "" };

  return { label: relativeLabel(date, now), absolute: absoluteLabel(date) };
}

export function formatDateRange(earliest: string, latest: string): string {
  const start = parseUtc(earliest);
  const end = parseUtc(latest);
  if (!start && !end) return "";
  if (!start || !end) return dayWithYear((start ?? end) as Date);

  const sameDay =
    start.getUTCFullYear() === end.getUTCFullYear() &&
    start.getUTCMonth() === end.getUTCMonth() &&
    start.getUTCDate() === end.getUTCDate();
  if (sameDay) return dayWithYear(end);

  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const startLabel = sameYear ? dayNoYear(start) : dayWithYear(start);
  return `${startLabel} – ${dayWithYear(end)}`;
}

export function formatDuration(startedAt: string, endedAt: string): string {
  const start = parseUtc(startedAt);
  const end = parseUtc(endedAt);
  if (!start || !end) return "";

  const seconds = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes === 0 ? `${hours}h` : `${hours}h ${remMinutes}m`;
}

export function formatDayKey(dayKey: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (parts === null) return dayKey;
  const month = MONTHS[Number(parts[2]) - 1];
  return month === undefined ? dayKey : `${month} ${Number(parts[3])}`;
}

function parseUtc(iso: string): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dayNoYear(date: Date): string {
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

function dayWithYear(date: Date): string {
  return `${dayNoYear(date)} ${date.getUTCFullYear()}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function relativeLabel(date: Date, now: Date): string {
  const sameYear = date.getUTCFullYear() === now.getUTCFullYear();
  const sameDay = sameYear && date.getUTCMonth() === now.getUTCMonth() && date.getUTCDate() === now.getUTCDate();

  if (sameDay) {
    const diffMinutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
    if (diffMinutes < 1) return "just now";
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    return `${Math.floor(diffMinutes / 60)}h ago`;
  }

  const month = MONTHS[date.getUTCMonth()];
  const day = date.getUTCDate();
  if (sameYear) return `${month} ${day}`;
  return `${month} ${day} ${date.getUTCFullYear()}`;
}

function absoluteLabel(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date);
}

export function formatChars(n: number | null): string {
  if (n === null) return "—";
  return formatCompactTokens(n);
}
