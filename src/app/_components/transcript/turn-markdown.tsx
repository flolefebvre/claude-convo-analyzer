import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// Renders an assistant turn's text as GitHub-flavoured markdown. Humans don't
// write reliable markdown, so ONLY assistant turns go through this — prompts
// render plain (see `TranscriptMessage`).
//
// Security: react-markdown escapes raw HTML by default and we deliberately do
// NOT add `rehype-raw` (or any dangerous-HTML plugin), so a turn containing
// `<script>`/`<img onerror>` is rendered as inert text, not live markup. The
// GFM plugin only adds tables/strikethrough/tasklists/autolinks — no HTML pass-
// through. This is a pure component and works inside the server component tree.

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
 * An assistant turn's markdown, rendered safely (no raw HTML).
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
