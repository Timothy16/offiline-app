// Voice input pipeline, JARVIS-style: tap (or keep talking after an answer) → listen (the speech
// engine transcribes while you talk and detects when you've finished) → command, navigation or
// question → the app responds aloud → it keeps listening for a follow-up until you go quiet.
// No text box to review: the app acts immediately; what it heard is shown on screen.
import type { Router } from 'vue-router'
import { matchCommand, matchNavigation, yesOrNo } from '~/lib/voice/commands'
import { playCue } from '~/lib/voice/cues'
import type { ListenSession } from '~/lib/voice/types'

export type MicState = 'idle' | 'starting' | 'listening' | 'finishing'

const state = ref<MicState>('idle')
/** Short status line near the mic ("Listening…", live words, "Heard: go to FAQ"). */
const caption = ref('')
/** True while a spoken conversation is going: the app listens again after each response. */
const conversing = ref(false)

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
  // Tap while the mic opens or listens: finish now and use what was heard so far.
  if (state.value === 'listening' || state.value === 'starting') {
    state.value = 'finishing'
    session?.stop()
    return
  }
  if (state.value === 'finishing') return
  await listen(false)
}

/** One spoken turn. `followUp`: listening again after a response, so silence just ends quietly. */
async function listen(followUp: boolean) {
  const speech = useSpeech()
  if (useSetup().phase.value !== 'ready') {
    show('Still getting ready…')
    speech.say('Please wait, I am still getting ready.')
    return
  }
  // Starting to listen interrupts everything: the answer being written and anything being said.
  useChat().stop()

  // "Starting" until the mic really captures: words spoken before that would be lost.
  state.value = 'starting'
  show(followUp ? 'Still listening…' : 'Starting the mic…', 0)
  let lastWordsAt = 0
  const current = useSTT().listen({
    onReady: () => {
      if (session !== current || state.value !== 'starting') return
      state.value = 'listening'
      show('Listening…', 0)
      void playCue('listening')
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
    conversing.value = false
    pendingConfirm = null
    const blocked = err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError')
    const notFound = err instanceof DOMException && err.name === 'NotFoundError'
    const message = blocked
      ? 'The microphone is blocked. Please allow it in your browser settings.'
      : notFound
        ? 'I could not find a microphone on this device.'
        : 'Sorry, something went wrong while listening.'
    show(message, 8000)
    void playCue('not-understood')
    speech.say(message)
    return
  }
  // A newer turn or a cancel replaced this one: nothing to do.
  if (session !== current) return
  session = null
  state.value = 'idle'

  if (!/\p{L}/u.test(text)) {
    // Silence after a response: the user is done, close quietly. After a tap: they wanted something.
    if (followUp) return endConversation()
    return didNotCatch()
  }

  void playCue('heard')
  conversing.value = true
  // Time from the last words appearing to having the final text.
  const sttMs = lastWordsAt ? Math.round(performance.now() - lastWordsAt) : undefined
  await handle(text, sttMs)
  await continueConversation()
}

function didNotCatch() {
  conversing.value = false
  pendingConfirm = null // an unanswered "Are you sure?" means no
  show('Sorry, I didn\'t catch that.')
  void playCue('not-understood')
  useSpeech().say('Sorry, I didn\'t catch that. Tap the mic and try again.')
}

async function handle(text: string, sttMs?: number) {
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

  // 1. Exact commands (instant, 0 MB): "go back", "read question three", "stop"…
  const match = matchCommand(text, useVoiceCommands().all())
  if (match) return match.command.run(match.args)

  // 2. Navigation by meaning: "I'm going to the chat screen", "take me to the FAQ page"…
  const screens = useVoiceCommands().screens()
  const target = matchNavigation(text, screens)
  if (target) return screens.find(s => s.id === target)!.go()

  // 3. Anything else is a question for the AI, answered aloud on the Chat screen. No spoken
  // echo (it delays the answer); the question is shown in the chat and in the caption.
  if (router && router.currentRoute.value.path !== '/') {
    quietNavigation = true
    await router.push('/')
  }
  useChat().send(text, { sttMs })
}

/** Resolves when nothing is being generated (the AI answer, if any, has finished). */
function chatIdle(): Promise<void> {
  const { busy } = useChat()
  if (!busy.value) return Promise.resolve()
  return new Promise((resolve) => {
    const stop = watch(busy, (b) => {
      if (!b) {
        stop()
        resolve()
      }
    })
  })
}

/** After a response, keep listening for a follow-up — like talking to a person. */
async function continueConversation() {
  if (!conversing.value) return
  // Let whatever was triggered start (answer stream, screen announcement), then wait until the
  // app has finished writing and speaking, so the mic never records the app's own voice.
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 250))
  await chatIdle()
  await useSpeech().whenIdle()
  // Stopped meanwhile, user started something else, or the app is in the background.
  if (!conversing.value || state.value !== 'idle' || document.visibilityState !== 'visible') return
  await listen(true)
}

/** Close the spoken conversation (silence, "thanks", "stop", typing, or a mic error). */
function endConversation() {
  if (session) {
    session.cancel()
    session = null
    state.value = 'idle'
  }
  pendingConfirm = null
  if (!conversing.value) return
  conversing.value = false
  show('', 0)
  void playCue('done')
}

/** For destructive commands: ask aloud; the answer is taken by the next listening turn. */
function confirm(prompt: string, run: () => void | Promise<void>) {
  pendingConfirm = { run }
  conversing.value = true
  show(prompt, 0)
  useSpeech().say(`${prompt} Say yes or no.`)
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
    conversing: readonly(conversing),
    init,
    tap,
    confirm,
    endConversation,
    consumeQuietNavigation,
  }
}
