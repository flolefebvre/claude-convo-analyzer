// What a pushed `v*` tag asks the release workflow (.github/workflows/release.yml)
// to do: publish package.json's version, or rehearse publishing it.

/** `release` publishes to npm and creates the GitHub release; `rehearsal` runs every job but publishes nothing. */
export type ReleaseKind = "release" | "rehearsal";

/** A semver pre-release: dot-separated, non-empty identifiers of alphanumerics and hyphens. */
const PRE_RELEASE_SUFFIX = /^[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*$/;

/**
 * The kind of release `tag` asks for: `release` for `v<version>`, `rehearsal`
 * for `v<version>-<pre-release>`. Throws, naming the tag and the version, for
 * any other tag.
 *
 * @example
 * releaseTagKind("v0.1.0-rc.1", "0.1.0"); // "rehearsal"
 */
export function releaseTagKind(tag: string, version: string): ReleaseKind {
  const releaseTag = `v${version}`;
  if (tag === releaseTag) return "release";
  if (tag.startsWith(`${releaseTag}-`) && PRE_RELEASE_SUFFIX.test(tag.slice(releaseTag.length + 1))) return "rehearsal";
  throw new Error(
    `Tag ${tag} does not match package.json's version ${version}: ` +
      `tag ${releaseTag} to release it, or ${releaseTag}-<pre-release> (e.g. ${releaseTag}-rc.1) to rehearse.`,
  );
}
