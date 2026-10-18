-- A Project is identified by its path alone (issue #119). One log folder can
-- feed several Projects (a session that enters a worktree) and several log
-- folders one Project, so a single folder name per Project was false data: the
-- log folder a Conversation is filed in is the directory of its `source_path`.
ALTER TABLE "project" DROP COLUMN "folder_name";

-- Whether a Conversation's own records stated its Project path (a `cwd`).
-- Only such Conversations decide the Project a cwd-less sibling in the same
-- log folder borrows; a borrowed or decoded path never votes.
--
-- Existing rows default to 0; the PARSER_VERSION bump in `src/core/refresh.ts`
-- re-parses them all, re-assigning each Conversation to its Project by path.
ALTER TABLE "conversation" ADD COLUMN "project_path_from_records" BOOLEAN NOT NULL DEFAULT false;
