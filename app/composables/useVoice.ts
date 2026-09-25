// Voice input pipeline: tap → listen (the speech engine transcribes while you talk and detects
// when you've finished) → command or question. No text box to review: the app acts immediately
// and says what it understood.
import type { Router } from 'vue-router'
import { matchCommand, yesOrNo } from '~/lib/voice/commands'
import type { ListenSession } from '~/lib/voice/types'

export type MicState = 'idle' | 'starting' | 'listening' | 'finishing'

const state = ref<MicState>('idle')
/** Short status line near the mic ("Listening…", live words, "Heard: go to FAQ"). */
const caption = ref('')

let session: ListenSession | null = null
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
  // Second tap while the mic opens or listens: finish now and use what was heard so far.
  if (state.value === 'listening' || state.value === 'starting') {
    state.value = 'finishing'
    session?.stop()
    return
  }
  if (state.value === 'finishing') return
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

  // "Starting" until the mic really captures: words spoken before that would be lost.
  state.value = 'starting'
  show('Starting the mic…', 0)
  let lastWordsAt = 0
  const current = useSTT().listen({
    onReady: () => {
      if (session !== current || state.value !== 'starting') return
      state.value = 'listening'
      show('Listening…', 0)
    },
    onPartial: (text) => {
      lastWordsAt = performance.now()
      if (text) show(`“${text}”`, 0)
    },
  })
  session = current

  let text: string
  try {
    text = await current.result
  }
  catch (err) {
    if (session === current) {
      session = null
      state.value = 'idle'
    }
    const blocked = err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError')
    const notFound = err instanceof DOMException && err.name === 'NotFoundError'
    const message = blocked
      ? 'The microphone is blocked. Please allow it in your browser settings.'
      : notFound
        ? 'I could not find a microphone on this device.'
        : 'Sorry, something went wrong while listening.'
    show(message, 8000)
    speech.say(message)
    return
  }
  // A newer turn replaced this one (it was cancelled): nothing to do.
  if (session !== current) return
  session = null
  state.value = 'idle'
  // Time from the last words appearing to having the final text.
  const sttMs = lastWordsAt ? Math.round(performance.now() - lastWordsAt) : undefined
  await handle(text, sttMs)
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
    caption: readonly(caption),
    init,
    tap,
    confirm,
    consumeQuietNavigation,
  }
}
