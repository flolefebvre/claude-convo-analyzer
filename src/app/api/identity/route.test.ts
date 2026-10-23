// The identity route, driven through its pipe: the launcher's loopback probe
// reads it to tell this app from another program holding the port.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { GET } from "./route";

const manifest = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf-8")) as {
  name: string;
  version: string;
};

describe("GET /api/identity", () => {
  it("answers the app's package name and the version it ships as", async () => {
    const res = await GET(new Request("http://127.0.0.1/api/identity"), { params: Promise.resolve({}) });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: manifest.name, version: manifest.version });
  });
});
