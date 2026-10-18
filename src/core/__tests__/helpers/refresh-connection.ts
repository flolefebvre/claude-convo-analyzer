// Fault injection into a Refresh's write path: a Refresh writes through the
// bare better-sqlite3 connection `openRefreshConnection` returns, so a test
// mocks that export with a connection whose chosen statements run a hook first.
//
// Not a test file: it is excluded from vitest's `include` (see
// `vitest.config.ts`) because it declares no tests of its own.

import type Database from "better-sqlite3";

/** The statement methods that execute SQL. */
const EXECUTING_METHODS = new Set<PropertyKey>(["run", "get", "all", "iterate"]);

/**
 * Proxy `target` so each method runs on the real object (native methods reject
 * a proxy as `this`), and `replace` may swap in its own version of a method.
 */
function proxyWithMethods<Target extends object>(
  target: Target,
  replace: (prop: PropertyKey, original: (...args: unknown[]) => unknown) => ((...args: unknown[]) => unknown) | null,
): Target {
  const proxy: Target = new Proxy(target, {
    get(object, prop) {
      const value: unknown = Reflect.get(object, prop);
      if (typeof value !== "function") return value;
      const original = (...args: unknown[]) => {
        const result: unknown = (value as (...a: unknown[]) => unknown).apply(object, args);
        // Chaining methods (`pluck`, `raw`) return the statement: keep the proxy.
        return result === object ? proxy : result;
      };
      return replace(prop, original) ?? original;
    },
  });
  return proxy;
}

/**
 * Wrap a Refresh connection so every statement prepared from SQL that
 * `isHookedSql` accepts calls `beforeExecute` before it executes. A throw from
 * the hook aborts the Refresh at exactly that statement.
 *
 * @example
 * hookStatements(db, (sql) => sql.startsWith('INSERT INTO "conversation"'), () => probe());
 */
export function hookStatements(
  db: Database.Database,
  isHookedSql: (sql: string) => boolean,
  beforeExecute: () => void,
): Database.Database {
  return proxyWithMethods(db, (prop, prepare) => {
    if (prop !== "prepare") return null;
    return (sql: unknown) => {
      const statement = prepare(sql) as Database.Statement;
      if (typeof sql !== "string" || !isHookedSql(sql)) return statement;
      return proxyWithMethods(statement, (method, execute) => {
        if (!EXECUTING_METHODS.has(method)) return null;
        return (...args: unknown[]) => {
          beforeExecute();
          return execute(...args);
        };
      });
    };
  });
}
