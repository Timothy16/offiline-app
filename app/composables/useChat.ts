// Conversation state, independent of how text is entered (keyboard now, voice later).
import type { ChatMessage } from '~/lib/llm/types'

export interface ChatEntry {
  id: number
  role: 'user' | 'assistant'
  content: string
  state: 'streaming' | 'done' | 'stopped' | 'error'
}

const SYSTEM_PROMPT = 'You are Afronet, a helpful assistant running offline on the user\'s phone. Answer clearly and briefly.'

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

/** `queueSpeech`: read the answer after whatever is being said ("You asked: …") instead of cutting it off. */
async function send(text: string, { queueSpeech = false }: { queueSpeech?: boolean } = {}) {
  const content = text.trim()
  if (!content) return
  // A new question replaces an answer still being written (e.g. asked by voice mid-answer).
  if (busy.value) {
    controller?.abort()
    await current
  }
  current = answer(content, queueSpeech)
  return current
}

async function answer(content: string, queueSpeech: boolean) {
  const { generate } = useLLM()
  const speech = useSpeech()

  messages.value.push({ id: nextId++, role: 'user', content, state: 'done' })
  const context = buildContext()
  messages.value.push({ id: nextId++, role: 'assistant', content: '', state: 'streaming' })
  const reply = messages.value[messages.value.length - 1]!

  busy.value = true
  controller = new AbortController()
  // Read the answer aloud sentence by sentence while it is still being written.
  const voice = speech.stream(reply.id, { interrupt: !queueSpeech })
  try {
    for await (const chunk of generate(context, { signal: controller.signal })) {
      reply.content += chunk
      voice.push(chunk)
    }
    reply.state = controller.signal.aborted ? 'stopped' : 'done'
    voice.end()
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
  return { messages: readonly(messages), busy: readonly(busy), send, stop, clear }
}
