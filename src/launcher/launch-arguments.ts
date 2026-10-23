// The launcher's command line: which port to serve on and whether to open the
// browser. A fixed default port, so a bookmark keeps working across launches.

/** The port the app serves on when neither `--port` nor `PORT` names one. */
export const DEFAULT_PORT = 4747;

/** The usage text `--help` prints, and an invalid command line points at. */
export const LAUNCH_USAGE = `Usage: claude-convo-analyzer [--port <number>] [--no-open]

  --port <number>  Serve on this port (default ${DEFAULT_PORT}, or the PORT environment variable)
  --no-open        Do not open the browser
  -h, --help       Show this help`;

/** What the command line asks for: a launch, the usage, or nothing valid. */
export type LaunchRequest =
  | { kind: "launch"; port: number; shouldOpenBrowser: boolean }
  | { kind: "help" }
  | { kind: "invalid"; message: string };

/** `raw` as a TCP port, or `null` when it is not an integer from 1 to 65535. */
function portFrom(raw: string): number | null {
  const port = Number(raw);
  return /^\d+$/.test(raw) && port >= 1 && port <= 65535 ? port : null;
}

/** The invalid request for a port `raw` read from `source` (`--port`, `PORT`). */
function invalidPort(source: string, raw: string): LaunchRequest {
  return { kind: "invalid", message: `${source}: expected an integer from 1 to 65535, got "${raw}"` };
}

/**
 * The launch the arguments after the command (`process.argv.slice(2)`) and the
 * environment ask for. `--port` wins over `PORT`; an empty `PORT` counts as unset.
 *
 * @example parseLaunchArguments(["--port", "5000", "--no-open"], process.env); // { kind: "launch", port: 5000, shouldOpenBrowser: false }
 */
export function parseLaunchArguments(argv: string[], env: Record<string, string | undefined>): LaunchRequest {
  let portArgument: string | undefined;
  let shouldOpenBrowser = true;
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i];
    if (argument === "--help" || argument === "-h") return { kind: "help" };
    if (argument === "--no-open") {
      shouldOpenBrowser = false;
    } else if (argument.startsWith("--port=")) {
      portArgument = argument.slice("--port=".length);
    } else if (argument === "--port") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("-"))
        return { kind: "invalid", message: "--port: expected a port number" };
      portArgument = value;
      i++;
    } else {
      return { kind: "invalid", message: `unknown argument "${argument}"` };
    }
  }

  if (portArgument !== undefined) {
    const port = portFrom(portArgument);
    return port === null ? invalidPort("--port", portArgument) : { kind: "launch", port, shouldOpenBrowser };
  }
  if (env.PORT) {
    const port = portFrom(env.PORT);
    return port === null ? invalidPort("PORT", env.PORT) : { kind: "launch", port, shouldOpenBrowser };
  }
  return { kind: "launch", port: DEFAULT_PORT, shouldOpenBrowser };
}
