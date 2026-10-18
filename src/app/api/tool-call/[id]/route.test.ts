// The tool-call body route, driven through its pipe: the exported `GET` is
// called as Next calls it, against the default database — stubbed ONCE for the
// file to a temp copy of the fixture, since the process-wide client binds to
// `CCA_DB_PATH` on first use (see `default-db-singleton.test.ts`).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { getPrismaClient } from "@/core/db";
import { getTranscript } from "@/core/read";
import { refresh } from "@/core/refresh";

import { GET } from "./route";

// Outside Next there is no request scope for `connection()` to find: stand in
// for the one Next opens around every route handler call.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));

const FIXTURES_ROOT = path.join(process.cwd(), "src", "core", "__tests__", "fixtures", "tool-body-logs");

/** Call the route for the raw `[id]` segment `id`. */
async function getBody(id: string): Promise<{ status: number; json: unknown }> {
  const res = await GET(new Request(`http://localhost/api/tool-call/${id}`), { params: Promise.resolve({ id }) });
  return { status: res.status, json: await res.json() };
}

describe("GET /api/tool-call/[id]", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "cca-tool-call-route-"));
    vi.stubEnv("CCA_DB_PATH", path.join(tmpDir, "analyzer.db"));
    await refresh({ logsRoot: FIXTURES_ROOT });
  });

  afterAll(async () => {
    await getPrismaClient().$disconnect();
    vi.unstubAllEnvs();
    rmSync(tmpDir, { recursive: true, force: true });
  });

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

  it.each(["abc", "0", "-3", "1.5"])("answers 400 for the malformed id %j", async (id) => {
    expect((await getBody(id)).status).toBe(400);
  });
});
