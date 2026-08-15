import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function TurnMarkdown({ text }: { text: string }) {
  return <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>;
}
