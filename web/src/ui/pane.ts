// The large pane: `show` markdown, or the handoff view while one is open.

import { renderMarkdown } from "../markdown.ts";

export class Pane {
  readonly el: HTMLElement;
  private readonly content: HTMLElement;
  private hosted: HTMLElement | null = null;

  constructor() {
    this.el = document.createElement("section");
    this.el.className = "pane";
    this.content = document.createElement("div");
    this.content.className = "pane__content";
    this.el.appendChild(this.content);
  }

  showMarkdown(markdown: string): void {
    this.content.innerHTML = renderMarkdown(markdown);
    this.el.classList.toggle("pane--content", this.content.childElementCount > 0);
    this.content.scrollTop = 0;
  }

  /** Put the handoff view in front of the content. */
  host(view: HTMLElement): void {
    if (this.hosted === view) return;
    this.unhost();
    this.hosted = view;
    this.el.appendChild(view);
    this.el.classList.add("pane--handoff");
  }

  unhost(): void {
    if (this.hosted) {
      this.hosted.remove();
      this.hosted = null;
    }
    this.el.classList.remove("pane--handoff");
  }
}
