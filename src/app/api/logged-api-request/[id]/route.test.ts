// The routes of a logged API request's What was sent and its Raw sibling,
// driven through their pipes: each exported `GET` is called as Next calls it,
// against the default database (`refreshedDefaultDatabase`), one for the whole
// file, Refreshed from logs holding request records.

import { describe, expect, it } from "vitest";

import { getTranscript } from "@/core/read";

import { coreFixtureLogsRoot, refreshedDefaultDatabase } from "../../__tests__/helpers/default-database";
import { GET as getLoggedRawApiRequestRoute } from "./raw/route";
import { GET as getLoggedWhatWasSentRoute } from "./route";

/** Either route: what was sent, or raw. */
type LoggedApiRequestRoute = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

/** Status and JSON body of `route` called for the raw `[id]` segment `id`. */
async function answerOf(route: LoggedApiRequestRoute, id: string): Promise<{ status: number; json: unknown }> {
  const res = await route(new Request(`http://localhost/api/logged-api-request/${id}`), {
    params: Promise.resolve({ id }),
  });
  return { status: res.status, json: await res.json() };
}

/** The `logged_api_request` row id of the fixture's first Main-thread Turn its file holds the request of. */
async function firstLoggedTurnId(): Promise<string> {
  const view = await getTranscript("sess-logged");
  const source = view?.messages.find((message) => message.whatWasSentSource?.from === "logs")?.whatWasSentSource;
  if (source?.from !== "logs") throw new Error("the fixture has no logged Turn");
  return String(source.loggedApiRequestId);
}

refreshedDefaultDatabase({
  prefix: "cca-logged-api-request-route-",
  logsRoot: coreFixtureLogsRoot("logged-request-logs"),
});

describe("GET /api/logged-api-request/[id]", () => {
  it("answers a logged Turn's API request with what was sent, its messages not rebuilt yet", async () => {
    const res = await answerOf(getLoggedWhatWasSentRoute, await firstLoggedTurnId());

    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      parameters: { model: "claude-opus-4-8", maxTokens: 32000, betas: ["beta-one", "beta-two"] },
      timings: null,
      failedAttempts: [],
      previousApiRequestId: null,
      fullRequest: { messages: null, tools: [{ name: "Bash" }] },
    });
  });
});

describe("GET /api/logged-api-request/[id]/raw", () => {
  it("answers the body the logs rebuild so far, with no response and no headers", async () => {
    const res = await answerOf(getLoggedRawApiRequestRoute, await firstLoggedTurnId());

    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      requestBody: { model: "claude-opus-4-8", system: expect.any(Array), tools: expect.any(Array) },
      responseBody: null,
      requestHeaders: null,
    });
    expect(res.json).not.toHaveProperty("requestBody.messages");
  });
});

describe.each([
  ["what was sent", getLoggedWhatWasSentRoute],
  ["raw", getLoggedRawApiRequestRoute],
] as const)("the %s route", (_, route) => {
  it("answers 404 for an unknown id", async () => {
    expect((await answerOf(route, "999999")).status).toBe(404);
  });

  it.each(["abc", "0", "-3", "1.5", "2147483648"])("answers 400 for the malformed id %j", async (id) => {
    expect((await answerOf(route, id)).status).toBe(400);
  });
});
