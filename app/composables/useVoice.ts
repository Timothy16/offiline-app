// Voice input pipeline: tap → listen (auto-stops on silence) → transcribe → command or question.
// No text box to review: the app acts immediately and says what it understood.
import type { Router } from 'vue-router'
import { matchCommand, yesOrNo } from '~/lib/voice/commands'
import { MicRecorder } from '~/lib/voice/recorder'

export type MicState = 'idle' | 'listening' | 'transcribing'

const state = ref<MicState>('idle')
/** 0..1 microphone level while listening, for the visual meter. */
const level = ref(0)
/** Short status line under the mic ("Listening…", "Heard: go to FAQ"). */
const caption = ref('')

const recorder = new MicRecorder()
let router: Router | null = null
let pendingConfirm: { run: () => void | Promise<void> } | null = null
/** Set when voice navigation should not be announced (e.g. a question sent to Chat). */
let quietNavigation = false
let captionTimer: ReturnType<typeof setTimeout> | undefined

function show(text: string, holdMs = 4000) {
  caption.value = text
  clearTimeout(captionTimer)
  if (holdMs) captionTimer = setTimeout(() => (caption.value = ''), holdMs)
}

/** The layout hands over the router (composables outside setup can't reach it). */
function init(r: Router) {
  router = r
}

async function tap() {
  if (state.value === 'listening') return recorder.stop()
  if (state.value === 'transcribing') return
  await listen()
}

async function listen() {
  const speech = useSpeech()
  if (useSetup().phase.value !== 'ready') {
    show('Still getting ready…')
    speech.say('Please wait, I am still getting ready.')
    return
  }
  // Tapping the mic interrupts everything: the answer being written and anything being said.
  useChat().stop()

  state.value = 'listening'
  show('Listening…', 0)
  let recording
  try {
    recording = await recorder.record({ onLevel: l => (level.value = l) })
  }
  catch (err) {
    state.value = 'idle'
    const blocked = err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError')
    const message = blocked
      ? 'The microphone is blocked. Please allow it in your browser settings.'
      : 'I could not use the microphone.'
    show(message, 8000)
    speech.say(message)
    return
  }

  if (!recording.hadSpeech) {
    state.value = 'idle'
    return didNotCatch()
  }

  state.value = 'transcribing'
  show('Understanding…', 0)
  let text = ''
  const sttStart = performance.now()
  try {
    text = await useSTT().transcribe(recording.blob)
  }
  catch {
    state.value = 'idle'
    show('Something went wrong while listening.')
    speech.say('Sorry, something went wrong while listening.')
    return
  }
  state.value = 'idle'
  await handle(text, Math.round(performance.now() - sttStart))
}

function didNotCatch() {
  pendingConfirm = null // an unanswered "Are you sure?" means no
  show('Sorry, I didn\'t catch that.')
  useSpeech().say('Sorry, I didn\'t catch that. Tap the mic and try again.')
}

async function handle(text: string, sttMs?: number) {
  if (!/\p{L}/u.test(text)) return didNotCatch()
  show(`Heard: “${text}”`)
  const speech = useSpeech()

  // Answer to "Are you sure?"
  if (pendingConfirm) {
    const confirm = pendingConfirm
    pendingConfirm = null
    const answer = yesOrNo(text)
    if (answer === 'yes') return confirm.run()
    speech.say(answer === 'no' ? 'Okay, cancelled.' : 'Okay, I will leave it.')
    return
  }

  const match = matchCommand(text, useVoiceCommands().all())
  if (match) return match.command.run(match.args)

  // Not a command: it's a question for the AI, answered aloud on the Chat screen. No spoken
  // echo (it delays the answer); the question is shown in the chat and in the caption.
  if (router && router.currentRoute.value.path !== '/') {
    quietNavigation = true
    await router.push('/')
  }
  useChat().send(text, { sttMs })
}

/** For destructive commands: ask aloud, then listen for yes/no without another tap. */
async function confirm(prompt: string, run: () => void | Promise<void>) {
  pendingConfirm = { run }
  show(prompt, 0)
  await useSpeech().say(`${prompt} Say yes or no.`)
  if (pendingConfirm && state.value === 'idle') await listen()
}

/** Screen announcements check this so voice-driven questions aren't talked over. */
function consumeQuietNavigation() {
  const quiet = quietNavigation
  quietNavigation = false
  return quiet
}

export function useVoice() {
  return {
    state: readonly(state),
    level: readonly(level),
    caption: readonly(caption),
    init,
    tap,
    confirm,
    consumeQuietNavigation,
  }
}
