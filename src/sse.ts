// Incremental parser for text/event-stream: feed raw decoded chunks, get
// back complete events (the text between blank-line separators).
export class SseParser {
  private buffer = "";

  push(chunk: string): string[] {
    this.buffer += chunk;
    const events: string[] = [];
    let match: RegExpExecArray | null;
    const separator = /\r?\n\r?\n/g;
    let consumed = 0;
    while ((match = separator.exec(this.buffer)) !== null) {
      events.push(this.buffer.slice(consumed, match.index));
      consumed = match.index + match[0].length;
    }
    this.buffer = this.buffer.slice(consumed);
    return events.filter((e) => e.length > 0);
  }

  flush(): string[] {
    const rest = this.buffer;
    this.buffer = "";
    return rest.trim().length > 0 ? [rest] : [];
  }
}

// Returns the joined `data:` payload of an event, or null for comment-only /
// non-data events (e.g. ": keep-alive").
export function eventData(event: string): string | null {
  const lines = event.split(/\r?\n/).filter((l) => l.startsWith("data:"));
  if (lines.length === 0) return null;
  return lines.map((l) => l.slice(5).replace(/^ /, "")).join("\n");
}
