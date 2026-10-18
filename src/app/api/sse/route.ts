// `GET /api/sse` — the one Server-Sent Events stream every page holds open,
// carrying the `refresh` Channel. next-sse's own handler rather than a next-pipe
// route: a route pipe answers JSON and cannot stream (`docs/codebase/app-router.md`).

import { sse } from "@/app/_lib/sse";

export const { GET } = sse.handlers;
