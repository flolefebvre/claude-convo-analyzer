import { describe, expect, it } from "vitest";

import {
  folderScopeHref,
  isProjectInFolderScope,
  isSameFolderScope,
  resolveFolderScope,
  writeFolderScope,
} from "@/app/_lib/folder-scope";

describe("resolveFolderScope", () => {
  it("reads the Folder path and the this-folder narrowing", () => {
    expect(resolveFolderScope({ folder: "/a/b", thisFolder: "1" })).toEqual({ folder: "/a/b", thisFolderOnly: true });
    expect(resolveFolderScope({ folder: ["/a/b", "/c"] })).toEqual({ folder: "/a/b", thisFolderOnly: false });
  });

  it("reads no Folder as All folders, whatever thisFolder says", () => {
    expect(resolveFolderScope({})).toEqual({ folder: undefined, thisFolderOnly: false });
    expect(resolveFolderScope({ folder: "", thisFolder: "1" })).toEqual({ folder: undefined, thisFolderOnly: false });
  });

  it("only narrows on the canonical value", () => {
    expect(resolveFolderScope({ folder: "/a", thisFolder: "yes" }).thisFolderOnly).toBe(false);
  });
});

describe("isProjectInFolderScope", () => {
  it("spans the Folder's own path and every path below it", () => {
    expect(isProjectInFolderScope("/a/b", { folder: "/a/b" })).toBe(true);
    expect(isProjectInFolderScope("/a/b/c/d", { folder: "/a/b" })).toBe(true);
  });

  it("leaves out a sibling that shares the prefix without a `/` boundary", () => {
    expect(isProjectInFolderScope("/a/bc", { folder: "/a/b" })).toBe(false);
  });

  it("narrows to the Folder's own path for this folder", () => {
    expect(isProjectInFolderScope("/a/b", { folder: "/a/b", thisFolderOnly: true })).toBe(true);
    expect(isProjectInFolderScope("/a/b/c", { folder: "/a/b", thisFolderOnly: true })).toBe(false);
  });

  it("spans every Project when unscoped", () => {
    expect(isProjectInFolderScope("/x", {})).toBe(true);
  });
});

describe("writeFolderScope", () => {
  it("writes both params, and clears both for All folders", () => {
    const params = new URLSearchParams("sortBy=cost");
    writeFolderScope(params, { folder: "/a", thisFolderOnly: true });
    expect(params.toString()).toBe("sortBy=cost&folder=%2Fa&thisFolder=1");
    writeFolderScope(params, { folder: "/a" });
    expect(params.toString()).toBe("sortBy=cost&folder=%2Fa");
    writeFolderScope(params, { folder: "/b", thisFolderOnly: true });
    writeFolderScope(params, {});
    expect(params.toString()).toBe("sortBy=cost");
  });
});

describe("folderScopeHref", () => {
  it("re-scopes the live query, keeping sort and range but dropping the open row and page", () => {
    expect(folderScopeHref("sortBy=cost&range=7&expanded=s1&page=3", { folder: "/a", thisFolderOnly: true })).toBe(
      "?sortBy=cost&range=7&folder=%2Fa&thisFolder=1",
    );
  });

  it("drops a this-folder narrowing when moving to a whole subtree", () => {
    expect(folderScopeHref("folder=%2Fa&thisFolder=1", { folder: "/a/b" })).toBe("?folder=%2Fa%2Fb");
  });

  it("clears the scope for All folders", () => {
    expect(folderScopeHref("folder=%2Fa&thisFolder=1&range=7", {})).toBe("?range=7");
  });
});

describe("isSameFolderScope", () => {
  it("tells a subtree scope from the same Folder narrowed to this folder", () => {
    expect(isSameFolderScope({ folder: "/a" }, { folder: "/a", thisFolderOnly: false })).toBe(true);
    expect(isSameFolderScope({ folder: "/a" }, { folder: "/a", thisFolderOnly: true })).toBe(false);
    expect(isSameFolderScope({}, { folder: undefined })).toBe(true);
  });
});
