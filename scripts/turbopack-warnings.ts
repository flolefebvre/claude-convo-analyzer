// What `pnpm build` (scripts/build.ts) fails on: the warning block `next build`
// prints and still exits 0 after, as Next.js 16.4's print-build-errors.js
// formats it — a `Turbopack build encountered N warning(s):` header, then the
// warnings.

import { stripVTControlCharacters } from "node:util";

const WARNING_HEADER = /^Turbopack build encountered \d+ warnings?:$/m;
const ROUTE_TABLE_HEADER = /^Route \(/m;

/**
 * The Turbopack warning block in `next build`'s output, without color codes,
 * or null when the build printed none.
 *
 * @example
 * const warningBlock = turbopackWarningBlock(buildOutput);
 * if (warningBlock !== null) console.error(warningBlock);
 */
export function turbopackWarningBlock(buildOutput: string): string | null {
  const plainOutput = stripVTControlCharacters(buildOutput);
  const header = WARNING_HEADER.exec(plainOutput);
  if (header === null) return null;
  const fromHeader = plainOutput.slice(header.index);
  // Nothing in the block marks its end, and Next's own log lines share its indent:
  // the route table, printed after it, is the first line that reliably is not part of it.
  const routeTable = ROUTE_TABLE_HEADER.exec(fromHeader);
  return (routeTable === null ? fromHeader : fromHeader.slice(0, routeTable.index)).trimEnd();
}
