/** A program and its arguments, as `child_process.spawn` takes them. */
export type Command = { command: string; args: string[] };

/**
 * The command that opens `url` in the default browser on `platform`
 * (`process.platform`).
 *
 * @example browserOpenCommand("darwin", "http://127.0.0.1:4747"); // { command: "open", args: ["http://127.0.0.1:4747"] }
 */
export function browserOpenCommand(platform: NodeJS.Platform, url: string): Command {
  if (platform === "darwin") return { command: "open", args: [url] };
  // `start` is a cmd builtin; its first quoted argument is the window title.
  if (platform === "win32") return { command: "cmd", args: ["/c", "start", '""', url] };
  return { command: "xdg-open", args: [url] };
}
