// App-wide speech output. Everything the app says goes through here, so one "stop" silences it all.
// Only this file knows which TTSEngine is used (built-in voice now; Piper with fallback later).
import { SentenceSplitter } from '~/lib/voice/speakable'
import type { TTSEngine, TTSStatus } from '~/lib/voice/types'
import { WebSpeechTTS } from '~/lib/voice/web-speech-tts'

const STORAGE_KEY = 'afronet.speech.enabled'

const enabled = ref(true)
const speaking = ref(false)
/** Which chat message is being read, so its bubble can show a stop button. */
const speakingId = ref<number | null>(null)
const status = ref<TTSStatus | null>(null)

let engine: TTSEngine | null = null
const getEngine = () => (engine ??= new WebSpeechTTS())

// Sentences waiting to be spoken. `session` changes on stop() so an old loop quits quietly.
let queue: string[] = []
let session = 0
let pumping = false
let streamOpen = false
/** Resolved when the app goes quiet (finished or stopped): lets callers wait for a prompt. */
let idleWaiters: (() => void)[] = []
/** Everything said since the last interruption, for "repeat". */
let lastSaid = ''

function becameIdle() {
  speaking.value = false
  speakingId.value = null
  const waiters = idleWaiters
  idleWaiters = []
  waiters.forEach(w => w())
}

async function pump() {
  if (pumping) return
  pumping = true
  const mine = session
  speaking.value = true
  while (queue.length && mine === session) {
    await getEngine().speak(queue.shift()!)
  }
  // A loop from before stop() must not touch state that now belongs to a newer session.
  if (mine !== session) return
  pumping = false
  if (!streamOpen) becameIdle()
}

function enqueue(sentences: string[]) {
  if (!enabled.value || !sentences.length) return
  queue.push(...sentences)
  lastSaid += `${sentences.join(' ')} `
  pump()
}

function stop() {
  session++
  queue = []
  streamOpen = false
  getEngine().stop()
  pumping = false
  becameIdle()
}

/** Resolves once nothing is being said (immediately if already quiet). */
function whenIdle(): Promise<void> {
  if (!speaking.value && !queue.length && !streamOpen) return Promise.resolve()
  return new Promise(resolve => idleWaiters.push(resolve))
}

/**
 * Speak a complete text, interrupting anything else by default. Resolves when it has been said
 * (or was interrupted), so callers can e.g. listen for an answer right after a question.
 */
function say(text: string, { id = null, interrupt = true }: { id?: number | null, interrupt?: boolean } = {}) {
  if (interrupt) {
    stop()
    lastSaid = ''
  }
  if (!enabled.value) return Promise.resolve()
  if (id !== null) speakingId.value = id
  enqueue(new SentenceSplitter().push(`${text}\n`))
  return whenIdle()
}

/**
 * Speak a reply while it streams: push() per chunk, end() when done. With `interrupt: false`
 * it queues after whatever is being said (e.g. "You asked: …").
 */
function stream(id: number | null = null, { interrupt = true }: { interrupt?: boolean } = {}) {
  if (interrupt) {
    stop()
    lastSaid = ''
  }
  const splitter = new SentenceSplitter()
  const mine = session
  speakingId.value = id
  streamOpen = true
  return {
    push(chunk: string) {
      if (mine === session) enqueue(splitter.push(chunk))
    },
    end() {
      if (mine !== session) return
      streamOpen = false
      enqueue(splitter.flush())
      if (!queue.length && !pumping) becameIdle()
    },
  }
}

/** Say the last thing again ("repeat"). Returns false when there is nothing to repeat. */
function repeat(): boolean {
  const text = lastSaid.trim()
  if (!text) return false
  say(text)
  return true
}

function setEnabled(value: boolean) {
  enabled.value = value
  if (!value) stop()
  try {
    localStorage.setItem(STORAGE_KEY, value ? '1' : '0')
  }
  catch {}
}

async function init() {
  try {
    enabled.value = localStorage.getItem(STORAGE_KEY) !== '0'
  }
  catch {}
  status.value = await getEngine().inspect()
}

export function useSpeech() {
  return {
    enabled: readonly(enabled),
    speaking: readonly(speaking),
    speakingId: readonly(speakingId),
    status: readonly(status),
    init,
    say,
    stream,
    stop,
    repeat,
    whenIdle,
    setEnabled,
  }
}
