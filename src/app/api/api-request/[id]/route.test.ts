// The routes of an API request's What was sent and its Raw sibling,
// driven through their pipes: each exported `GET` is called as Next calls it,
// against the default database (`refreshedDefaultDatabase`), one for the whole
// file, Refreshed from logs holding request records.

import { describe, expect, it } from "vitest";

import { getTranscript } from "@/core/read";

import { coreFixtureLogsRoot, refreshedDefaultDatabase } from "../../__tests__/helpers/default-database";
import { GET as getRawApiRequestRoute } from "./raw/route";
import { GET as getWhatWasSentRoute } from "./route";

/** Either route: what was sent, or raw. */
type ApiRequestRoute = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

/** Status and JSON body of `route` called for the raw `[id]` segment `id`. */
async function answerOf(route: ApiRequestRoute, id: string): Promise<{ status: number; json: unknown }> {
  const res = await route(new Request(`http://localhost/api/api-request/${id}`), {
    params: Promise.resolve({ id }),
  });
  return { status: res.status, json: await res.json() };
}

/** The `api_request` row id of the fixture's first Main-thread Turn its file holds the request of. */
async function firstTurnApiRequestId(): Promise<string> {
  const view = await getTranscript("sess-logged");
  const apiRequestId = view?.messages.find((message) => message.apiRequestId !== null)?.apiRequestId;
  if (apiRequestId == null) throw new Error("the fixture has no Turn with an API request");
  return String(apiRequestId);
}

refreshedDefaultDatabase({
  prefix: "cca-api-request-route-",
  logsRoot: coreFixtureLogsRoot("logged-request-logs"),
});

describe("GET /api/api-request/[id]", () => {
  it("answers a Turn's API request with what was sent, its messages included", async () => {
    const res = await answerOf(getWhatWasSentRoute, await firstTurnApiRequestId());

    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      parameters: { model: "claude-opus-4-8", maxTokens: 32000, betas: ["beta-one", "beta-two"] },
      failedAttempts: [],
      previousApiRequestId: null,
      fullRequest: { messages: expect.any(Array), tools: [{ name: "Bash" }] },
    });
  });
});

describe("GET /api/api-request/[id]/raw", () => {
  it("answers the body the logs rebuild", async () => {
    const res = await answerOf(getRawApiRequestRoute, await firstTurnApiRequestId());

    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      requestBody: {
        model: "claude-opus-4-8",
        system: expect.any(Array),
        tools: expect.any(Array),
        messages: expect.any(Array),
      },
      missingMessageCount: 0,
    });
  });
});

describe.each([
  ["what was sent", getWhatWasSentRoute],
  ["raw", getRawApiRequestRoute],
] as const)("the %s route", (_, route) => {
  it("answers 404 for an unknown id", async () => {
    expect((await answerOf(route, "999999")).status).toBe(404);
  });

  it.each(["abc", "0", "-3", "1.5", "2147483648"])("answers 400 for the malformed id %j", async (id) => {
    expect((await answerOf(route, id)).status).toBe(400);
  });
});
