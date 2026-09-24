// Matches a spoken sentence to a voice command. Whole-sentence matching (not "contains"), so
// "how do I go back to school?" stays a question while "go back" is a command.
// English only for now; phrases live with each command so other languages can be added later.

export interface VoiceCommand {
  id: string
  /** Ways to say it. `{n}` matches a number ("question {n}" ↔ "question three"). */
  phrases: string[]
  run: (args: { n?: number }) => void | Promise<void>
}

export interface CommandMatch {
  command: VoiceCommand
  args: { n?: number }
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, first: 1, two: 2, second: 2, three: 3, third: 3, four: 4, fourth: 4,
  five: 5, fifth: 5, six: 6, sixth: 6, seven: 7, seventh: 7, eight: 8, eighth: 8, nine: 9, ninth: 9,
  ten: 10, tenth: 10, eleven: 11, twelve: 12,
}

// Words that don't change what the user wants. Removed from both sides before comparing.
const FILLERS = new Set([
  'please', 'can', 'could', 'would', 'will', 'you', 'i', 'want', 'wanna', 'like', 'id', 'to', 'lets', 'let', 'us',
  'now', 'the', 'a', 'an', 'me', 'my', 'for', 'just', 'kindly', 'hey', 'afronet', 'okay', 'ok', 'so', 'um', 'uh',
  'page', 'screen', 'section', 'tab', 'number', 'again',
])

/** Lowercase, drop punctuation, spell "F.A.Q." consistently. */
function clean(text: string): string {
  return text
    .toLowerCase()
    .replace(/\bf\.?\s?a\.?\s?q\.?s?\b|\bfaqs\b/g, 'faq')
    .replace(/[^\p{L}\p{N}\s{}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Tokens with fillers removed and number words turned into digits. */
function tokens(text: string): string[] {
  return clean(text)
    .split(' ')
    .map(w => (w in NUMBER_WORDS ? String(NUMBER_WORDS[w]) : w))
    .filter(w => w && !FILLERS.has(w))
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]!
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return row[b.length]!
}

function matchPhrase(said: string[], phrase: string): { n?: number } | null {
  const want = tokens(phrase)
  const heard = said
  if (heard.length !== want.length) return null

  let n: number | undefined
  let mistakes = 0
  for (let i = 0; i < want.length; i++) {
    if (want[i] === '{n}') {
      if (!/^\d+$/.test(heard[i]!)) return null
      n = Number(heard[i])
    }
    else if (heard[i] !== want[i]) {
      // Allow small mishearings in longer words ("questions" ↔ "question", "chats" ↔ "chat").
      const d = editDistance(heard[i]!, want[i]!)
      if (want[i]!.length < 4 || d > 1) return null
      mistakes++
    }
  }
  return mistakes <= 1 ? { n } : null
}

export function matchCommand(text: string, commands: readonly VoiceCommand[]): CommandMatch | null {
  // Commands are short; anything long is a question for the AI.
  if (clean(text).split(' ').length > 8) return null
  const said = tokens(text)
  if (!said.length) return null
  for (const command of commands) {
    for (const phrase of command.phrases) {
      const args = matchPhrase(said, phrase)
      if (args) return { command, args }
    }
  }
  return null
}

const YES = new Set(['yes', 'yeah', 'yep', 'sure', 'ok', 'okay', 'correct', 'confirm', 'do it', 'go ahead', 'yes please'])
const NO = new Set(['no', 'nope', 'cancel', 'dont', 'do not', 'stop', 'no thanks', 'never mind', 'nevermind'])

/** For "Are you sure?" prompts. */
export function yesOrNo(text: string): 'yes' | 'no' | null {
  const said = clean(text).replace(/\bthank you\b|\bthanks\b/g, '').trim()
  if (YES.has(said) || said.startsWith('yes ')) return 'yes'
  if (NO.has(said) || said.startsWith('no ')) return 'no'
  return null
}
