// The tool-call body route, driven through its pipe: the exported `GET` is
// called as Next calls it, against the default database
// (`refreshedDefaultDatabase`).

import { describe, expect, it } from "vitest";

import { getTranscript } from "@/core/read";

import { coreFixtureLogsRoot, refreshedDefaultDatabase } from "../../__tests__/helpers/default-database";
import { GET } from "./route";

/** Call the route for the raw `[id]` segment `id`. */
async function getBody(id: string): Promise<{ status: number; json: unknown }> {
  const res = await GET(new Request(`http://localhost/api/tool-call/${id}`), { params: Promise.resolve({ id }) });
  return { status: res.status, json: await res.json() };
}

describe("GET /api/tool-call/[id]", () => {
  refreshedDefaultDatabase({ prefix: "cca-tool-call-route-", logsRoot: coreFixtureLogsRoot("tool-body-logs") });

  it("answers a known id with the Tool call's body", async () => {
    const view = await getTranscript("sess-toolbody");
    const call = view?.messages.flatMap((m) => m.toolCalls).find((c) => c.toolUseId === "toolu-b-edit");

    const res = await getBody(String(call?.id));

    expect(res).toEqual({
      status: 200,
      json: {
        inputJson: JSON.stringify({ file_path: "/Users/me/dev/toolbody/a.ts", old_string: "a", new_string: "b" }),
        resultText: "Error: string to replace not found in file",
        resultTruncated: false,
        resultCharSize: 42,
        isError: true,
      },
    });
  });

  it("answers 404 for an unknown id", async () => {
    expect((await getBody("999999")).status).toBe(404);
  });

  it.each(["abc", "0", "-3", "1.5", "2147483648"])("answers 400 for the malformed id %j", async (id) => {
    expect((await getBody(id)).status).toBe(400);
  });
});
