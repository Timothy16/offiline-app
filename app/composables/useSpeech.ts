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
  if (!streamOpen) {
    speaking.value = false
    speakingId.value = null
  }
}

function enqueue(sentences: string[]) {
  if (!enabled.value || !sentences.length) return
  queue.push(...sentences)
  pump()
}

function stop() {
  session++
  queue = []
  streamOpen = false
  getEngine().stop()
  pumping = false
  speaking.value = false
  speakingId.value = null
}

/** Speak a complete text now, interrupting anything else (confirmations, replays). */
function say(text: string, id: number | null = null) {
  stop()
  if (!enabled.value) return
  speakingId.value = id
  enqueue(new SentenceSplitter().push(`${text}\n`))
}

/** Speak a reply while it streams: call push() per chunk and end() when done. */
function stream(id: number | null = null) {
  stop()
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
      if (!queue.length && !pumping) {
        speaking.value = false
        speakingId.value = null
      }
    },
  }
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
    setEnabled,
  }
}
