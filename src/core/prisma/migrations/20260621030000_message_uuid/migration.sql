-- Persist each message's record `uuid` so continued-from resolution can be made
-- authoritative against the DATABASE (covering ALL conversations), not just the
-- conversations freshly parsed in the current incremental refresh. A child's
-- first-message `parentUuid` points at the parent message's `uuid`; on an
-- incremental run the parent may be unchanged (and thus skipped), so its uuids
-- must be queryable from persisted rows for the link to resolve.
ALTER TABLE "message" ADD COLUMN "uuid" TEXT;
CREATE INDEX "message_uuid_idx" ON "message"("uuid");
