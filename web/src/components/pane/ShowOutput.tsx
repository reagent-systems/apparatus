// `show` markdown through the DOM-free renderer; every character is escaped there.

import { renderMarkdown } from "@/markdown";

export function ShowOutput({ markdown }: { markdown: string | null }) {
  if (!markdown) return <div className="h-full" />;
  return <div className="show-output px-6 py-5 text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }} />;
}
