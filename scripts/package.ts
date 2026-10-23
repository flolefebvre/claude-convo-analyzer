#!/usr/bin/env tsx
/**
 * `pnpm package`: build the npm package `npx claude-convo-analyzer` runs. A
 * `next build` with standalone output (`NPM_PACKAGE_BUILD=1`, read by
 * next.config.ts, through `pnpm build` and its Turbopack-warning guard), then
 * the publishable tree in `dist/claude-convo-analyzer/`:
 *
 *   package.json  generated: no scripts, no dev dependencies, better-sqlite3 its only dependency
 *   bin/          the launcher (src/launcher/), compiled to CommonJS
 *   app/          the standalone server: server.js, .next/ (static assets included),
 *                 node_modules/, the Prisma migrations
 *
 * and its tarball beside it, `dist/claude-convo-analyzer-<version>.tgz`
 * (`npm pack`), whose path is the last line printed. Exits non-zero, naming the
 * cause, when the build fails or the tree breaks a rule below.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distDir = path.join(repoRoot, "dist");
const packageDir = path.join(distDir, "claude-convo-analyzer");
const appDir = path.join(packageDir, "app");
const standaloneDir = path.join(repoRoot, ".next", "standalone");

/**
 * Never shipped: better-sqlite3's native binding must match the user's
 * platform and Node, so npm installs it there (the generated manifest's one
 * dependency), and Node finds it by walking up from the app. These are it and
 * its own dependencies.
 */
const PACKAGES_INSTALLED_BY_NPM = new Set(["better-sqlite3", "bindings", "file-uri-to-path"]);

const manifest = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf-8")) as {
  name: string;
  version: string;
  description: string;
  license: string;
  repository: unknown;
  dependencies: Record<string, string>;
};

/** Run `command` with `args` from the repo root, failing the package when it fails; returns its stdout when captured. */
function run(command: string, args: string[], options: { env?: NodeJS.ProcessEnv; captureOutput?: boolean } = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: options.env ?? process.env,
    stdio: options.captureOutput ? ["ignore", "pipe", "inherit"] : "inherit",
    shell: process.platform === "win32",
    encoding: "utf-8",
  });
  if (result.status !== 0) fail(`${command} ${args.join(" ")} exited with ${result.status ?? result.error?.message}`);
  return result.stdout ?? "";
}

function fail(message: string): never {
  console.error(`\nPackage failed: ${message}`);
  process.exit(1);
}

/** The package directory names in a `node_modules` directory, scoped ones as `@scope/name`. */
function packageNamesIn(nodeModulesDir: string): string[] {
  return readdirSync(nodeModulesDir)
    .filter((entry) => !entry.startsWith("."))
    .flatMap((entry) =>
      entry.startsWith("@")
        ? readdirSync(path.join(nodeModulesDir, entry)).map((scoped) => `${entry}/${scoped}`)
        : [entry],
    );
}

/**
 * The standalone's `node_modules`, flattened into `app/node_modules`. This
 * tracks how Next lays out a pnpm install's trace, and assumes:
 *
 * - every traced package is a real directory at `.pnpm/<id>/node_modules/<name>`,
 *   and every other entry (`node_modules/<name>`, the dependencies beside a
 *   package in `.pnpm/<id>/node_modules/`, `.pnpm/node_modules/`) is a symlink
 *   to one of them. npm pack drops symlinks, so the tree must hold none;
 * - each traced package name comes in one version, so each can sit at the top
 *   of `app/node_modules`, where every package finds it by walking up. A second
 *   version fails the package rather than guessing which one a dependent needs.
 */
function copyFlattenedNodeModules() {
  const pnpmStoreDir = path.join(standaloneDir, "node_modules", ".pnpm");
  if (!existsSync(pnpmStoreDir)) fail(`no ${pnpmStoreDir}: the standalone output is not pnpm's layout any more`);
  const sourceDirByName = new Map<string, string>();
  for (const id of readdirSync(pnpmStoreDir).filter((entry) => entry !== "node_modules")) {
    const idNodeModulesDir = path.join(pnpmStoreDir, id, "node_modules");
    for (const name of packageNamesIn(idNodeModulesDir)) {
      const sourceDir = path.join(idNodeModulesDir, name);
      if (lstatSync(sourceDir).isSymbolicLink() || PACKAGES_INSTALLED_BY_NPM.has(name)) continue;
      const earlierDir = sourceDirByName.get(name);
      if (earlierDir !== undefined) fail(`two versions of ${name} are traced (${earlierDir}, ${sourceDir})`);
      sourceDirByName.set(name, sourceDir);
      cpSync(sourceDir, path.join(appDir, "node_modules", name), { recursive: true, dereference: true });
    }
  }
}

/**
 * The aliases Turbopack requires the server external packages under
 * (next.config.ts's `serverExternalPackages`), in `.next/node_modules/`. This
 * assumes each is a symlink, named after its package plus a hash, to the
 * package's directory in the standalone. A package npm installs becomes a
 * two-file package re-exporting it by name, which Node resolves upward to the
 * user's copy; any other is copied whole.
 */
function copyExternalAliases() {
  const aliasesDir = path.join(standaloneDir, ".next", "node_modules");
  if (!existsSync(aliasesDir)) return;
  for (const alias of packageNamesIn(aliasesDir)) {
    const aliasPath = path.join(aliasesDir, alias);
    if (!lstatSync(aliasPath).isSymbolicLink())
      fail(`${aliasPath} is no symlink: Turbopack's external aliases changed`);
    if (!existsSync(aliasPath)) fail(`${aliasPath} points at nothing the standalone traced`);
    const targetDir = realpathSync(aliasPath);
    const { name } = JSON.parse(readFileSync(path.join(targetDir, "package.json"), "utf-8")) as { name: string };
    const destinationDir = path.join(appDir, ".next", "node_modules", alias);
    if (PACKAGES_INSTALLED_BY_NPM.has(name)) {
      mkdirSync(destinationDir, { recursive: true });
      writeFileSync(
        path.join(destinationDir, "package.json"),
        `${JSON.stringify({ name: alias, main: "index.js" })}\n`,
      );
      writeFileSync(path.join(destinationDir, "index.js"), `module.exports = require(${JSON.stringify(name)});\n`);
    } else {
      cpSync(targetDir, destinationDir, { recursive: true, dereference: true });
    }
  }
}

/** The standalone server, its build output and static assets, and the migrations it reads, into `app/`. */
function copyApp() {
  cpSync(path.join(standaloneDir, "server.js"), path.join(appDir, "server.js"));
  cpSync(path.join(standaloneDir, ".next"), path.join(appDir, ".next"), {
    recursive: true,
    filter: (source) => source !== path.join(standaloneDir, ".next", "node_modules"),
  });
  cpSync(path.join(repoRoot, ".next", "static"), path.join(appDir, ".next", "static"), { recursive: true });
  cpSync(path.join(standaloneDir, "src"), path.join(appDir, "src"), { recursive: true });
  if (existsSync(path.join(repoRoot, "public"))) {
    cpSync(path.join(repoRoot, "public"), path.join(appDir, "public"), { recursive: true });
  }
  copyFlattenedNodeModules();
  copyExternalAliases();
}

/**
 * The launcher, compiled per file to CommonJS for an ES2017 runtime: old
 * enough syntax that any Node still in use parses the entry and reaches its
 * version check. The entry is the command's name, `bin/claude-convo-analyzer.js`.
 */
function compileLauncher() {
  const launcherDir = path.join(repoRoot, "src", "launcher");
  const binDir = path.join(packageDir, "bin");
  mkdirSync(binDir, { recursive: true });
  for (const file of readdirSync(launcherDir).filter((entry) => entry.endsWith(".ts") && !entry.endsWith(".test.ts"))) {
    const { outputText } = ts.transpileModule(readFileSync(path.join(launcherDir, file), "utf-8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2017,
        esModuleInterop: true,
      },
      fileName: file,
    });
    writeFileSync(path.join(binDir, file.replace(/\.ts$/, ".js")), outputText);
  }
  chmodSync(path.join(binDir, "claude-convo-analyzer.js"), 0o755);
}

/** The published manifest: what npm needs to install and run the package, nothing of the repo's tooling. */
function writeManifest() {
  const publishedManifest = {
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    license: manifest.license,
    repository: manifest.repository,
    bin: { "claude-convo-analyzer": "bin/claude-convo-analyzer.js" },
    engines: { node: ">=20.9" },
    dependencies: { "better-sqlite3": manifest.dependencies["better-sqlite3"] },
  };
  writeFileSync(path.join(packageDir, "package.json"), `${JSON.stringify(publishedManifest, null, 2)}\n`);
  cpSync(path.join(repoRoot, "README.md"), path.join(packageDir, "README.md"));
  cpSync(path.join(repoRoot, "LICENSE"), path.join(packageDir, "LICENSE"));
}

/** Every path under `dir`, depth first, without following symlinks. */
function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    yield entryPath;
    if (entry.isDirectory()) yield* walk(entryPath);
  }
}

/** Fails the package unless the tree holds no symlink and no native binding, and has the server and the migrations. */
function assertPackageTree() {
  for (const entryPath of walk(packageDir)) {
    if (lstatSync(entryPath).isSymbolicLink())
      fail(`symlink left in the package, which npm pack would drop: ${entryPath}`);
    if (entryPath.endsWith(".node")) fail(`native binding in the package, built for this machine only: ${entryPath}`);
  }
  const migrationsDir = path.join(appDir, "src", "core", "prisma", "migrations");
  const hasMigrations =
    existsSync(migrationsDir) &&
    readdirSync(migrationsDir).some((entry) => existsSync(path.join(migrationsDir, entry, "migration.sql")));
  if (!hasMigrations) fail(`no Prisma migration in ${migrationsDir}: a new database could not be created`);
  for (const required of ["server.js", path.join(".next", "static"), path.join(".next", "BUILD_ID")]) {
    if (!existsSync(path.join(appDir, required))) fail(`no ${required} in ${appDir}`);
  }
}

rmSync(distDir, { recursive: true, force: true });
rmSync(standaloneDir, { recursive: true, force: true });
run("pnpm", ["build"], { env: { ...process.env, NPM_PACKAGE_BUILD: "1" } });
copyApp();
compileLauncher();
writeManifest();
assertPackageTree();
const tarballName = run("npm", ["pack", packageDir, "--pack-destination", distDir], { captureOutput: true })
  .trim()
  .split("\n")
  .at(-1);
if (!tarballName) fail("npm pack printed no tarball name");
console.log(`\nPackaged ${manifest.name}@${manifest.version}:`);
console.log(path.join(distDir, tarballName));
