// Tiny, safe Markdown subset for model answers: escapes all HTML first, then applies
// **bold**, *italic*, `code`, headings, bullet/numbered lists and paragraphs.
// Deliberately no links or images — nothing in an answer should reach the network.

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function inline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
}

export function renderMarkdown(src: string): string {
  const lines = escapeHtml(src).split('\n')
  const out: string[] = []
  let list: 'ul' | 'ol' | null = null
  let para: string[] = []

  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join('<br>'))}</p>`)
    para = []
  }
  const closeList = () => {
    if (list) out.push(`</${list}>`)
    list = null
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/)
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/)
    const heading = line.match(/^#{1,6}\s+(.*)$/)

    if (bullet || numbered) {
      flushPara()
      const type = bullet ? 'ul' : 'ol'
      if (list !== type) {
        closeList()
        out.push(`<${type}>`)
        list = type
      }
      out.push(`<li>${inline((bullet ?? numbered)![1]!)}</li>`)
    }
    else if (heading) {
      flushPara()
      closeList()
      out.push(`<p><strong>${inline(heading[1]!)}</strong></p>`)
    }
    else if (!line.trim()) {
      flushPara()
      closeList()
    }
    else {
      closeList()
      para.push(line)
    }
  }
  flushPara()
  closeList()
  return out.join('')
}
