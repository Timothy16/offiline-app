// Conversation state, independent of how text is entered (keyboard or voice).
import type { ChatMessage } from '~/lib/llm/types'

export interface ChatEntry {
  id: number
  role: 'user' | 'assistant'
  content: string
  state: 'streaming' | 'done' | 'stopped' | 'error'
  /** Where the time went, shown under the answer while we tune speed (ms). */
  timing?: { sttMs?: number, firstTextMs?: number, firstSpeechMs?: number, totalMs?: number }
}

// Answers are spoken, so they must be short. Never mention "offline" here: a small model reads it
// as "I have no information" and refuses. The prompt is processed once at startup (warmUp) and
// then reused from llama.cpp's prompt cache.
const SYSTEM_PROMPT = [
  'You are Afronet, a friendly and helpful assistant.',
  'Answer every question from your own knowledge in 1 to 3 short, simple sentences, as if speaking out loud.',
  'Never refuse or say you cannot access information.',
  'If a question is unclear, give the most likely answer, or ask one short question to clarify.',
  'For current events, people in office, or prices, say what you know and that it may be out of date.',
].join(' ')

// ~1-3 spoken sentences; also caps how long a slow phone can spend on one answer.
const MAX_ANSWER_TOKENS = 200

// Model context is 2048 tokens; ~4000 chars of history (~1000 tokens) leaves room for the answer
// and keeps prompt processing fast on low-end phones.
const MAX_HISTORY_CHARS = 4000

const messages = ref<ChatEntry[]>([])
const busy = ref(false)
let controller: AbortController | null = null
let current: Promise<void> | null = null
let nextId = 1

/** Most recent turns that fit the budget, always starting on a user turn. */
function buildContext(): ChatMessage[] {
  const turns: ChatMessage[] = []
  let chars = 0
  for (let i = messages.value.length - 1; i >= 0; i--) {
    const m = messages.value[i]!
    if (m.state === 'error' || (m.role === 'assistant' && !m.content)) continue
    if (chars + m.content.length > MAX_HISTORY_CHARS && turns.length) break
    turns.unshift({ role: m.role, content: m.content })
    chars += m.content.length
  }
  while (turns[0]?.role === 'assistant') turns.shift()
  return [{ role: 'system', content: SYSTEM_PROMPT }, ...turns]
}

/** Process the system prompt once after loading, so the first real question starts faster. */
async function warmUp() {
  const { generate } = useLLM()
  for await (const _ of generate([{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: 'Hi' }], { maxNewTokens: 1 })) {
    // discard: only the cached prompt matters
  }
}

/** `sttMs`: how long speech recognition took, when the question was spoken (for the timing line). */
async function send(text: string, { sttMs }: { sttMs?: number } = {}) {
  const content = text.trim()
  if (!content) return
  // A new question replaces an answer still being written (e.g. asked by voice mid-answer).
  if (busy.value) {
    controller?.abort()
    await current
  }
  current = answer(content, sttMs)
  return current
}

async function answer(content: string, sttMs?: number) {
  const { generate } = useLLM()
  const speech = useSpeech()

  messages.value.push({ id: nextId++, role: 'user', content, state: 'done' })
  const context = buildContext()
  messages.value.push({ id: nextId++, role: 'assistant', content: '', state: 'streaming', timing: { sttMs } })
  const reply = messages.value[messages.value.length - 1]!
  const timing = reply.timing!

  busy.value = true
  controller = new AbortController()
  // Read the answer aloud while it is still being written (first phrase, then sentence by sentence).
  const voice = speech.stream(reply.id)
  const start = performance.now()
  const since = () => Math.round(performance.now() - start)
  try {
    for await (const chunk of generate(context, { signal: controller.signal, maxNewTokens: MAX_ANSWER_TOKENS })) {
      timing.firstTextMs ??= since()
      reply.content += chunk
      if (voice.push(chunk)) timing.firstSpeechMs ??= since()
    }
    reply.state = controller.signal.aborted ? 'stopped' : 'done'
    if (voice.end()) timing.firstSpeechMs ??= since()
    timing.totalMs = since()
  }
  catch (err) {
    reply.state = 'error'
    reply.content = err instanceof Error ? err.message : String(err)
    speech.say('Sorry, I could not answer that.')
  }
  finally {
    busy.value = false
    controller = null
  }
}

/** Stop everything: the answer being written and anything being read aloud. */
function stop() {
  controller?.abort()
  useSpeech().stop()
}

function clear() {
  if (busy.value) return
  useSpeech().stop()
  messages.value = []
}

export function useChat() {
  return { messages: readonly(messages), busy: readonly(busy), send, stop, clear, warmUp }
}
