import { Markdown } from "@earendil-works/pi-tui";

type RenderedMarkdown = { width: number; lines: string[] };

/** Reuse chat Markdown when a terminal switches between two sizes. */
export class TranscriptMarkdown extends Markdown {
  private recent?: RenderedMarkdown;
  private previous?: RenderedMarkdown;

  override render(width: number): string[] {
    if (this.recent?.width === width) return this.recent.lines;
    const hit = this.previous?.width === width ? this.previous : undefined;
    const lines = hit?.lines ?? super.render(width);
    this.previous = this.recent;
    this.recent = hit ?? { width, lines };
    return lines;
  }

  override setText(text: string): void {
    this.recent = undefined;
    this.previous = undefined;
    super.setText(text);
  }

  override invalidate(): void {
    this.recent = undefined;
    this.previous = undefined;
    super.invalidate();
  }
}
