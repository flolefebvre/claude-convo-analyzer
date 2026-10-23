// Which app this is and which version it runs, read from the root package.json
// at build time: the manifest the npm package is generated from, so the version
// shown is the one the package ships as.

import manifest from "../../package.json";

/** The npm package name, which the launcher compares against `GET /api/identity`. */
export const APP_PACKAGE_NAME: string = manifest.name;

/** The version the app runs, as `0.1.0`; shown in the app bar as `v0.1.0`. */
export const APP_VERSION: string = manifest.version;
