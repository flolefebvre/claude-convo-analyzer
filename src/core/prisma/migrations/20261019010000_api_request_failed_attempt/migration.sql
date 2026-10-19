-- Failed attempts of a Turn (issue #130): a request that did not succeed and
-- that a later API request of the same Agent, sending the same body, retried
-- as a Turn, now points at that Turn through `message_id`/`agent_id`, marked
-- by `is_failed_attempt`. `error_message` is the response body's
-- `error.message` (else the proxy error) of any API request.
--
-- Backfill of already-ingested conversations is handled by the PARSER_VERSION
-- bump in `src/core/refresh.ts`, not by touching rows here.
ALTER TABLE "api_request" ADD COLUMN "is_failed_attempt" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "api_request" ADD COLUMN "error_message" TEXT;
