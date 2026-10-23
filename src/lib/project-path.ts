// The shape of a Project or Folder path (GLOSSARY.md, **Project**, **Folder**):
// a path starting with a drive (`C:\`) is a Windows path, `\`-separated; any
// other is a POSIX path, `/`-separated. The shape is read from the path itself,
// never from the OS the app runs on, so Windows logs read from WSL and on
// Windows give the same Projects. A root ends with its own separator (`/`,
// `C:\`); every other path does not.
//
// Paths compare as recorded: exact case, and no `/` ⇄ `\` normalisation within
// one path. UNC paths (`\\server\share`) are out of scope.
//
// Import-free — no `node:` modules, no `@/core` — so any bundle can take it:
// the core's, the server components' and the client sidebar's.

/** The character a path separates its segments with. */
export type PathSeparator = "/" | "\\";

/** A Windows path: a drive letter, a colon, a backslash. */
const WINDOWS_PATH_SHAPE = /^[A-Za-z]:\\/;

/** A Folder scope: All folders when `folder` is absent or empty (the `?folder=` and `?thisFolder=` values). */
export type FolderScope = {
  /** Scope to the Folder at this absolute path and everything below it. */
  folder?: string;
  /** Narrow {@link folder} to its own Project's Conversations (**this folder**). */
  thisFolderOnly?: boolean;
};

/**
 * The separator of `path`, from its shape.
 *
 * @example separatorOf("C:\\Users\\me") // "\\"
 */
export function separatorOf(path: string): PathSeparator {
  return WINDOWS_PATH_SHAPE.test(path) ? "\\" : "/";
}

/**
 * True when `path` is absolute in either shape: it starts with `/` or a drive.
 *
 * @example isAbsolutePath("C:\\Users\\me") // true
 */
export function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || WINDOWS_PATH_SHAPE.test(path);
}

/**
 * The non-empty segments of `path`; a Windows path's drive is its first.
 *
 * @example pathSegments("C:\\Users\\me") // ["C:", "Users", "me"]
 */
export function pathSegments(path: string): string[] {
  return path.split(separatorOf(path)).filter((segment) => segment.length > 0);
}

/**
 * The friendly name of a path: its last segment, or "" when it has none.
 *
 * @example friendlyName("C:\\Users\\me\\repo") // "repo"
 */
export function friendlyName(path: string): string {
  return pathSegments(path).at(-1) ?? "";
}

/**
 * The root of `path`'s shape: its drive (`C:\`) or `/`.
 *
 * @example filesystemRootOf("D:\\work\\api") // "D:\\"
 */
export function filesystemRootOf(path: string): string {
  return WINDOWS_PATH_SHAPE.test(path) ? path.slice(0, 3) : "/";
}

/**
 * The path of `name` directly inside `folder`, joined with the folder's
 * separator — once, since a root already ends with it.
 *
 * @example childPath("C:\\", "Users") // "C:\\Users"
 */
export function childPath(folder: string, name: string): string {
  const separator = separatorOf(folder);
  return folder.endsWith(separator) ? `${folder}${name}` : `${folder}${separator}${name}`;
}

/**
 * The segments of `path` below `folder` — `[]` at the folder itself — or null
 * when `path` is not at or below it. Below means past the folder's separator
 * (`/a/b` holds `/a/b/c`, not `/a/bc`); a root holds every path of its shape.
 *
 * @example segmentsBelow("C:\\Users\\me\\repo", "C:\\Users") // ["me", "repo"]
 */
export function segmentsBelow(path: string, folder: string): string[] | null {
  if (path === folder) return [];
  const prefix = childPath(folder, "");
  if (!path.startsWith(prefix)) return null;
  return path
    .slice(prefix.length)
    .split(separatorOf(folder))
    .filter((segment) => segment.length > 0);
}

/**
 * True when `path` is `folder` or lies below it (see {@link segmentsBelow}).
 *
 * @example isPathAtOrBelow("/a/b/c", "/a/b") // true
 */
export function isPathAtOrBelow(path: string, folder: string): boolean {
  return segmentsBelow(path, folder) !== null;
}

/**
 * True when a Project at `projectPath` lies in the scope: its path is the
 * Folder's, or — unless narrowed to this folder — below it.
 *
 * @example isProjectInFolderScope(row.project.path, scope)
 */
export function isProjectInFolderScope(projectPath: string, scope: FolderScope): boolean {
  if (!scope.folder) return true;
  if (projectPath === scope.folder) return true;
  return !scope.thisFolderOnly && isPathAtOrBelow(projectPath, scope.folder);
}
