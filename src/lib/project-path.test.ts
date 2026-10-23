// The path-shape rules every Project and Folder path goes through: the
// separator read from the path's shape, never the OS, and the scope rule
// built on it. Windows logs end to end: `src/core/__tests__/project-path.test.ts`.

import { describe, expect, it } from "vitest";

import {
  childPath,
  filesystemRootOf,
  friendlyName,
  isAbsolutePath,
  isPathAtOrBelow,
  isProjectInFolderScope,
  pathSegments,
  segmentsBelow,
  separatorOf,
} from "@/lib/project-path";

describe("Path shape", () => {
  it("reads a path starting with a drive as `\\`-separated, and any other as `/`-separated", () => {
    expect(separatorOf("C:\\Users\\me")).toBe("\\");
    expect(separatorOf("/mnt/c/Users/me")).toBe("/");
    expect(separatorOf("/home/me/dir\\with-backslash")).toBe("/");
  });

  it("splits a path into its non-empty segments, the drive first", () => {
    expect(pathSegments("C:\\Users\\me\\repo")).toEqual(["C:", "Users", "me", "repo"]);
    expect(pathSegments("/a/b/")).toEqual(["a", "b"]);
  });

  it("names a path by its last segment", () => {
    expect(friendlyName("C:\\Users\\me\\repo")).toBe("repo");
    expect(friendlyName("/home/me/api")).toBe("api");
    expect(friendlyName("C:\\")).toBe("C:");
  });

  it("finds the root of a path from its shape", () => {
    expect(filesystemRootOf("D:\\work\\api")).toBe("D:\\");
    expect(filesystemRootOf("/tmp/x")).toBe("/");
  });

  it("holds a path below a folder only across a separator", () => {
    expect(isPathAtOrBelow("C:\\Users\\me\\repo", "C:\\Users\\me")).toBe(true);
    expect(isPathAtOrBelow("C:\\Users\\me", "C:\\Users\\me")).toBe(true);
    expect(isPathAtOrBelow("C:\\Users\\meta", "C:\\Users\\me")).toBe(false);
    expect(isPathAtOrBelow("/a/bc", "/a/b")).toBe(false);
  });

  it("holds every path of its shape below a root, which ends with its own separator", () => {
    expect(isPathAtOrBelow("C:\\Users", "C:\\")).toBe(true);
    expect(isPathAtOrBelow("/tmp", "/")).toBe(true);
    expect(isPathAtOrBelow("D:\\work", "C:\\")).toBe(false);
    expect(isPathAtOrBelow("/c/Users", "C:\\")).toBe(false);
  });

  it("gives the segments of a path below a folder, or null outside it", () => {
    expect(segmentsBelow("C:\\Users\\me\\repo\\src", "C:\\Users\\me")).toEqual(["repo", "src"]);
    expect(segmentsBelow("C:\\Users", "C:\\")).toEqual(["Users"]);
    expect(segmentsBelow("/a/b", "/a/b")).toEqual([]);
    expect(segmentsBelow("/a/bc", "/a/b")).toBeNull();
  });

  it("joins a child name onto a folder with the folder's separator", () => {
    expect(childPath("C:\\Users", "me")).toBe("C:\\Users\\me");
    expect(childPath("C:\\", "Users")).toBe("C:\\Users");
    expect(childPath("/", "tmp")).toBe("/tmp");
    expect(childPath("/home", "me")).toBe("/home/me");
  });

  it("recognises an absolute path of either shape", () => {
    expect(isAbsolutePath("C:\\Users\\me")).toBe(true);
    expect(isAbsolutePath("C:\\")).toBe(true);
    expect(isAbsolutePath("/home/me")).toBe(true);
    expect(isAbsolutePath("C:")).toBe(false);
    expect(isAbsolutePath("repo\\src")).toBe(false);
    expect(isAbsolutePath("")).toBe(false);
  });
});

describe("isProjectInFolderScope", () => {
  it("spans the Folder's own path and every path below it", () => {
    expect(isProjectInFolderScope("/a/b", { folder: "/a/b" })).toBe(true);
    expect(isProjectInFolderScope("/a/b/c/d", { folder: "/a/b" })).toBe(true);
    expect(isProjectInFolderScope("C:\\Users\\me\\repo", { folder: "C:\\Users\\me" })).toBe(true);
    expect(isProjectInFolderScope("C:\\Users\\me\\repo", { folder: "C:\\" })).toBe(true);
  });

  it("leaves out a sibling that shares the prefix without a separator boundary", () => {
    expect(isProjectInFolderScope("/a/bc", { folder: "/a/b" })).toBe(false);
    expect(isProjectInFolderScope("C:\\Users\\meta", { folder: "C:\\Users\\me" })).toBe(false);
  });

  it("matches paths exactly, case included", () => {
    expect(isProjectInFolderScope("C:\\users\\me\\repo", { folder: "C:\\Users\\me" })).toBe(false);
  });

  it("narrows to the Folder's own path for this folder", () => {
    expect(isProjectInFolderScope("/a/b", { folder: "/a/b", thisFolderOnly: true })).toBe(true);
    expect(isProjectInFolderScope("/a/b/c", { folder: "/a/b", thisFolderOnly: true })).toBe(false);
  });

  it("spans every Project when unscoped", () => {
    expect(isProjectInFolderScope("/x", {})).toBe(true);
    expect(isProjectInFolderScope("C:\\x", { folder: "" })).toBe(true);
  });
});
