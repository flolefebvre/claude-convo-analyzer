-- The app no longer reads Recordings (issue #219, ADR-0007): `api_request`,
-- which only Recordings fed, goes with every row it held. The Recordings on
-- disk are left as they are.
--
-- No re-parse needed: no table the logs feed changes.

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "api_request";
PRAGMA foreign_keys=on;
