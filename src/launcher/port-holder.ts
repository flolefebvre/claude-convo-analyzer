// Who holds the launcher's port: nobody, a running copy of this app (a second
// launch), or another program. Told apart by a loopback request only: the
// holder's answer to `GET /api/identity`.

/** The launcher's port, as its probe found it. */
export type PortHolder = { kind: "free" } | { kind: "this app"; version: string } | { kind: "another program" };

/** What the launcher's probe saw on its port. */
export type PortProbe = {
  /** Whether the launcher could bind the port itself. */
  isBindable: boolean;
  /** The holder's parsed JSON answer to `GET /api/identity`; `undefined` when it gave none. */
  identity: unknown;
};

/**
 * Who holds the port `probe` saw, for the package named `packageName`.
 *
 * @example classifyPort({ isBindable: false, identity: { name: "claude-convo-analyzer", version: "0.1.0" } }, "claude-convo-analyzer"); // { kind: "this app", version: "0.1.0" }
 */
export function classifyPort(probe: PortProbe, packageName: string): PortHolder {
  if (probe.isBindable) return { kind: "free" };
  const identity = probe.identity;
  if (typeof identity === "object" && identity !== null && "name" in identity && "version" in identity) {
    const { name, version } = identity;
    if (name === packageName && typeof version === "string") return { kind: "this app", version };
  }
  return { kind: "another program" };
}
