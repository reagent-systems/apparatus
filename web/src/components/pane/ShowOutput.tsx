// `show` markdown through the DOM-free renderer; every character is escaped there.

import { renderMarkdown } from "@/markdown";
import { cn } from "@/lib/utils";

export function ShowOutput({ markdown, className }: { markdown: string | null; className?: string }) {
  if (!markdown) return <div data-slot="show-output" className="h-full" />;
  return (
    <div
      data-slot="show-output"
      className={cn("show-output px-6 py-5 text-[15px] leading-6 [&>:first-child]:mt-0", className)}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }}
    />
  );
}
