// Turns streamed model text into clean sentences for a voice: strips Markdown symbols and
// emits each sentence as soon as it is complete, so speech starts before the answer finishes.

/** Remove Markdown symbols that a voice would read out literally ("asterisk asterisk"). */
export function toSpeakable(text: string): string {
  return text
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/[*_#`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// A sentence ends at . ! ? followed by whitespace, or at a line break (list items, paragraphs).
const BOUNDARY = /[.!?](?=\s)|\n/g

export class SentenceSplitter {
  private buffer = ''

  /** Add streamed text; returns any sentences that are now complete. */
  push(chunk: string): string[] {
    this.buffer += chunk
    const out: string[] = []
    let start = 0
    for (const match of this.buffer.matchAll(BOUNDARY)) {
      const end = match.index! + match[0].length
      const sentence = toSpeakable(this.buffer.slice(start, end))
      // "1." of a numbered list has no words yet: keep it and join it to the next part.
      if (!/\p{L}/u.test(sentence)) continue
      out.push(sentence)
      start = end
    }
    this.buffer = this.buffer.slice(start)
    return out
  }

  /** Whatever is left when the stream ends. */
  flush(): string[] {
    const rest = toSpeakable(this.buffer)
    this.buffer = ''
    return rest ? [rest] : []
  }
}
