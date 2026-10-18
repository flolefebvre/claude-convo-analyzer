-- A Project is identified by its path alone (issue #119). One log folder can
-- feed several Projects (a session that enters a worktree) and several log
-- folders one Project, so a single folder name per Project was false data: the
-- log folder a Conversation is filed in is the directory of its `source_path`.
--
-- Re-assigning already-ingested Conversations to their Project by path is
-- handled by the PARSER_VERSION bump in `src/core/refresh.ts`.
ALTER TABLE "project" DROP COLUMN "folder_name";
