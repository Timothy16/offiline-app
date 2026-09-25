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

// How the speech model writes the letters of "FAQ" when it doesn't know the acronym.
const LETTER_F = new Set(['f', 'ef', 'eff'])
const LETTER_A = new Set(['a', 'ay', 'eh', 'ei'])
const LETTER_Q = new Set(['q', 'cue', 'queue', 'kew', 'kyu', 'que'])
// Blended into one word: "effecue", "efacue", "effakyu", "fak"… (not "effect", "fake").
const FAQ_BLENDED = /^e?ff?[aei]?[ckq](?:ue|ew|yu|u)?$/

/** Spoken-letter spellings of "FAQ" become "faq" ("go to effecue", "open the f a q page"). */
function normalizeFaq(words: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < words.length; i++) {
    const [a, b, c] = [words[i]!, words[i + 1], words[i + 2]]
    if (LETTER_F.has(a) && b && LETTER_A.has(b) && c && LETTER_Q.has(c)) {
      out.push('faq')
      i += 2
    }
    else {
      out.push(FAQ_BLENDED.test(a) ? 'faq' : a)
    }
  }
  return out
}

/** Lowercase, drop punctuation, spell "F.A.Q." (however it was heard) consistently. */
function clean(text: string): string {
  const words = text
    .toLowerCase()
    // Join contractions ("that's" → "thats", "I'm" → "im") so phrases can list them simply.
    .replace(/['’]/g, '')
    .replace(/\bf\.?\s?a\.?\s?q\.?s?\b|\bfaqs\b/g, 'faq')
    .replace(/[^\p{L}\p{N}\s{}]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
  return normalizeFaq(words).join(' ')
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

/** A screen that can be reached by voice, e.g. { id: 'faq', names: ['faq', 'frequently asked questions'] }. */
export interface VoiceScreen {
  id: string
  /** What people call it. Multi-word names are fine; keep them specific ("questions" alone is too vague). */
  names: string[]
}

// Words that signal "take me somewhere". Forms like "going"/"goes" are listed because the speech
// model often turns "go to" into "I'm going to".
const MOVE_WORDS = new Set([
  'go', 'goes', 'going', 'goto', 'open', 'opening', 'take', 'show', 'switch', 'move', 'navigate',
  'bring', 'return', 'visit', 'display', 'launch', 'jump', 'head', 'back',
])
const PLACE_WORDS = new Set(['screen', 'page', 'tab', 'section'])
// A sentence opening like this is asking something ("is it safe to go home…?"), unless it names a
// screen/page. Polite requests ("can you take me to…") are not in this list on purpose.
const QUESTION_STARTS = new Set(['what', 'whats', 'how', 'why', 'when', 'where', 'who', 'which', 'is', 'are', 'am', 'was', 'were', 'should', 'does', 'do', 'did', 'will', 'shall'])

/**
 * Understands navigation by meaning rather than exact phrases: a short sentence that names a screen
 * plus a movement word ("I'm going to chat screen", "take me to the FAQ page", "back to chat") or a
 * place word ("chat screen please"). Without either ("can you chat about malaria?") it stays a
 * question for the AI. Returns the screen id, or null.
 */
export function matchNavigation(text: string, screens: readonly VoiceScreen[]): string | null {
  const words = clean(text).split(' ').filter(Boolean)
  if (!words.length || words.length > 8) return null
  const joined = ` ${words.join(' ')} `
  const found = screens.filter(s => s.names.some(name => joined.includes(` ${clean(name)} `)))
  if (found.length !== 1) return null // none, or ambiguous ("go from chat to faq")
  const hasMove = words.some(w => MOVE_WORDS.has(w))
  const hasPlace = words.some(w => PLACE_WORDS.has(w))
  if (QUESTION_STARTS.has(words[0]!) && !hasPlace) return null
  return hasMove || hasPlace ? found[0]!.id : null
}

// Verbs that only mean "navigate" when followed by "to"/"back" ("take me to…", "go back to…"):
// without it they're everyday requests ("take a photo").
const NAV_VERBS = new Set(['go', 'goto', 'take', 'switch', 'navigate', 'bring', 'return', 'head', 'jump', 'move', 'back'])
// Verbs that only mean "navigate" together with screen/page ("open the settings page"):
// otherwise "show me how to cook rice" is a question.
const VIEW_VERBS = new Set(['open', 'show', 'display', 'launch', 'visit'])
// Politeness before the verb ("please", "can you", "hey Afronet").
const POLITE = new Set(['please', 'can', 'could', 'would', 'will', 'you', 'hey', 'afronet', 'okay', 'ok', 'lets', 'let', 'us', 'just', 'kindly', 'now', 'so'])

/** Letters that carry the sound of a word, for comparing a misheard word with a screen name. */
function skeleton(word: string): string {
  return word
    .replace(/ph/g, 'f')
    .replace(/[cq]/g, 'k')
    .replace(/[aeiouyhw]/g, '')
    .replace(/(.)\1+/g, '$1')
}

function editDistance2(a: string, b: string): number {
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

/** Does a heard word plausibly sound like this screen name? ("church" ~ "chat", "affect" ~ "faq") */
function soundsLike(heard: string, name: string): boolean {
  if (heard.length < 3) return false
  if (heard.slice(0, 2) === name.slice(0, 2) && heard.length <= 7) return true
  const a = skeleton(heard)
  const b = skeleton(name)
  if (!a || !b) return false
  return 1 - editDistance2(a, b) / Math.max(a.length, b.length) >= 0.6
}

export type NavigationGuess = { suggest: string } | { ask: true }

/**
 * For a sentence that is clearly trying to navigate but names no known screen (usually a mishearing:
 * "go back to church" for "chat"): suggest the screen it sounds like, or ask where to go. Either way
 * the sentence must not be sent to the AI as a question. Call only after matchNavigation failed.
 * Returns null when the sentence doesn't look like navigation at all.
 */
export function guessNavigation(text: string, screens: readonly VoiceScreen[]): NavigationGuess | null {
  const words = clean(text).split(' ').filter(Boolean)
  if (!words.length || words.length > 8) return null
  if (QUESTION_STARTS.has(words[0]!)) return null
  let i = 0
  while (i < words.length && POLITE.has(words[i]!)) i++
  const verb = words[i]
  const rest = words.slice(i + 1)
  const hasPlace = words.some(w => PLACE_WORDS.has(w))
  const navShaped
    = (verb !== undefined && NAV_VERBS.has(verb) && rest.slice(0, 3).some(w => w === 'to' || w === 'back' || w === 'into'))
      || (verb !== undefined && VIEW_VERBS.has(verb) && hasPlace)
      || (hasPlace && words.length <= 6)
  if (!navShaped) return null

  // Candidate words: what's left after verbs, politeness and filler.
  const skip = new Set([...NAV_VERBS, ...VIEW_VERBS, ...POLITE, ...PLACE_WORDS, 'to', 'the', 'me', 'my', 'a', 'an', 'into', 'of', 'please', 'i', 'im', 'going', 'want'])
  const heard = words.filter(w => !skip.has(w))
  const matches = screens.filter(s => s.names.some((name) => {
    const nameWords = clean(name).split(' ')
    return nameWords.length === 1 && heard.some(h => soundsLike(h, nameWords[0]!))
  }))
  return matches.length === 1 ? { suggest: matches[0]!.id } : { ask: true }
}
