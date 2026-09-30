// App-wide speech output. Everything the app says goes through here, so one "stop" silences it all.
// Only this file knows which TTSEngine is used: the natural voice (George) when it is on the
// device and keeping up, otherwise the phone's built-in voice — which always stays as the fallback.
import type { LoadProgress } from '~/lib/llm/types'
import { MoonshineTTS } from '~/lib/voice/moonshine-tts'
import { SentenceSplitter } from '~/lib/voice/speakable'
import type { TTSEngine, TTSStatus } from '~/lib/voice/types'
import { WebSpeechTTS } from '~/lib/voice/web-speech-tts'

const STORAGE_KEY = 'afronet.speech.enabled'
// Set when the natural voice could not keep up on this device, so it isn't loaded (109 MB, CPU)
// on every launch just to find that out again. Retried after a week: conditions change.
const SLOW_KEY = 'afronet.voice.tooSlowAt'
const SLOW_RETRY_MS = 7 * 24 * 60 * 60 * 1000

function rememberTooSlow() {
  try {
    localStorage.setItem(SLOW_KEY, String(Date.now()))
  }
  catch {}
}

/** True when this device recently proved too slow for the natural voice. */
function knownTooSlow(): boolean {
  try {
    const at = Number(localStorage.getItem(SLOW_KEY))
    return at > 0 && Date.now() - at < SLOW_RETRY_MS
  }
  catch {
    return false
  }
}

const enabled = ref(true)
const speaking = ref(false)
/** Which chat message is being read, so its bubble can show a stop button. */
const speakingId = ref<number | null>(null)
const status = ref<TTSStatus | null>(null)
/** True once the natural voice is loaded and in use. */
const naturalReady = ref(false)
/** Bytes still to download for the natural voice (0 = on the device, null = not checked yet). */
const naturalBytes = ref<number | null>(null)
/** True when the natural voice was tried and this device can't run it fast enough. */
const naturalTooSlow = ref(false)

const fallback: TTSEngine = new WebSpeechTTS()
let natural: TTSEngine | null = null
const getNatural = () => (natural ??= new MoonshineTTS())

/** The voice to use right now. Falls back for good once the natural voice can't keep up. */
function getEngine(): TTSEngine {
  if (naturalReady.value && natural) {
    if (!natural.tooSlow) return natural
    retireNatural() // this device stutters with it: stay on the built-in voice
  }
  return fallback
}

/** Stop using the natural voice on this device and free its memory and worker. */
function retireNatural() {
  naturalReady.value = false
  naturalTooSlow.value = true
  rememberTooSlow()
  natural?.dispose?.()
}

/** Let the engine synthesize the next sentence while the current one is still playing. */
function prepareNext() {
  if (queue.length) getEngine().prepare?.(queue[0]!)
}

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
    const text = queue.shift()!
    const engine = getEngine()
    prepareNext()
    try {
      await engine.speak(text)
    }
    catch {
      // The natural voice failed (worker crash, out of memory): say it with the built-in voice
      // and stay there, rather than going silent.
      if (engine !== fallback) {
        if (engine.tooSlow) retireNatural()
        else naturalReady.value = false
        if (mine === session) await fallback.speak(text).catch(() => {})
      }
    }
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
  if (pumping) prepareNext()
  pump()
}

function stop() {
  session++
  queue = []
  streamOpen = false
  fallback.stop()
  natural?.stop()
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

/** Speak a reply while it streams: push() per chunk, end() when done. Interrupts anything else. */
function stream(id: number | null = null) {
  stop()
  lastSaid = ''
  const splitter = new SentenceSplitter()
  const mine = session
  speakingId.value = id
  streamOpen = true
  // Both return true when they handed something to the voice (used to time "first words").
  return {
    push(chunk: string): boolean {
      if (mine !== session) return false
      const sentences = splitter.push(chunk)
      enqueue(sentences)
      return sentences.length > 0 && enabled.value
    },
    end(): boolean {
      if (mine !== session) return false
      streamOpen = false
      const rest = splitter.flush()
      enqueue(rest)
      if (!queue.length && !pumping) becameIdle()
      return rest.length > 0 && enabled.value
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
  const builtIn = await fallback.inspect()
  // Don't overwrite the natural voice's status if it finished loading first.
  if (!naturalReady.value) status.value = builtIn
}

/** How many bytes the natural voice still needs (0 when it is already on the device). */
async function inspectNatural(): Promise<number> {
  const s = await getNatural().inspect()
  naturalBytes.value = s.downloadBytes ?? 0
  return naturalBytes.value
}

/**
 * Download (if needed) and start the natural voice. Rejects on failure — the app then simply
 * keeps the built-in voice; nothing else depends on this.
 */
async function loadNatural(onProgress?: (p: LoadProgress) => void): Promise<'ready' | 'too-slow'> {
  const engine = getNatural()
  await engine.load!(onProgress)
  naturalBytes.value = 0
  // load() ends with a speed check; a device that can't keep up keeps the built-in voice.
  if (engine.tooSlow) {
    retireNatural()
    return 'too-slow'
  }
  naturalReady.value = true
  // The app can speak even on devices without any built-in English voice.
  status.value = { ...(await engine.inspect()), available: true }
  return 'ready'
}

export function useSpeech() {
  return {
    enabled: readonly(enabled),
    speaking: readonly(speaking),
    speakingId: readonly(speakingId),
    status: readonly(status),
    naturalReady: readonly(naturalReady),
    naturalBytes: readonly(naturalBytes),
    naturalTooSlow: readonly(naturalTooSlow),
    knownTooSlow,
    init,
    inspectNatural,
    loadNatural,
    say,
    stream,
    stop,
    repeat,
    whenIdle,
    setEnabled,
  }
}
