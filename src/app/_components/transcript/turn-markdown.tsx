import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// Renders agent-written text as GitHub-flavoured markdown: assistant turns,
// Inter-agent message bodies, Task notification results and an opened Tool
// call's markdown parts (the Agent call's Task prompt). Humans don't write
// reliable markdown, so user prompts never go through this — they render plain
// (see `TranscriptMessage`).
//
// Security: react-markdown escapes raw HTML by default and we deliberately do
// NOT add `rehype-raw` (or any dangerous-HTML plugin), so a turn containing
// `<script>`/`<img onerror>` is rendered as inert text, not live markup. The
// GFM plugin only adds tables/strikethrough/tasklists/autolinks — no HTML pass-
// through. This is a pure component: it renders in the server component tree,
// and in the client bundle under the tool-call disclosure.

/** A wide table scrolls sideways inside its own box instead of the column. */
const COMPONENTS: Components = {
  // GFM puts column alignment on the cells; the table itself carries none.
  table: ({ children }) => (
    <div className="table-wrap">
      <table>{children}</table>
    </div>
  ),
};

/**
 * Agent-written markdown, rendered safely (no raw HTML).
 *
 * @example <TurnMarkdown text={message.text ?? ""} />
 */
export function TurnMarkdown({ text }: { text: string }) {
  return (
    <Markdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
      {text}
    </Markdown>
  );
}
