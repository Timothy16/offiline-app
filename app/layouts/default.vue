<script setup lang="ts">
// Shared shell: header + tabs, app-wide voice commands, screen announcements, floating mic.
import type { RegisteredCommand } from '~/composables/useVoiceCommands'

const { $pwa } = useNuxtApp()
const route = useRoute()
const router = useRouter()
const speech = useSpeech()
const voice = useVoice()
const setup = useSetup()
const { messages, busy, clear } = useChat()

const online = ref(true)
function updateOnline() {
  online.value = navigator.onLine
}

/** Voice "new chat": clearing is destructive, so it asks first (a tapped button just clears). */
function newChat() {
  if (!messages.value.length) {
    speech.say('Started a new chat.')
    return
  }
  voice.confirm('Start a new chat? This clears the conversation.', () => {
    clear()
    speech.say('Started a new chat.')
  })
}

function goBack() {
  if (window.history.state?.back) router.back()
  else if (route.path !== '/') router.push('/')
  else speech.say('You are already on the first screen.')
}

// Commands that work on every screen. Screens add their own (see pages/*.vue).
const commands: RegisteredCommand[] = [
  { id: 'go-faq', help: 'go to FAQ', phrases: ['go faq', 'open faq', 'show faq', 'faq', 'frequently asked questions', 'take faq', 'questions and answers'], run: () => route.path === '/faq' ? speech.say('You are on the FAQ.') : router.push('/faq') },
  { id: 'go-chat', help: 'go to chat', phrases: ['go chat', 'open chat', 'chat', 'go home', 'home', 'take chat', 'take home'], run: () => route.path === '/' ? speech.say('You are on the chat.') : router.push('/') },
  { id: 'back', help: 'go back', phrases: ['go back', 'back', 'previous', 'return'], run: goBack },
  { id: 'new-chat', help: 'new chat', phrases: ['new chat', 'start new chat', 'clear chat', 'clear conversation', 'start over', 'new conversation'], run: newChat },
  { id: 'stop', phrases: ['stop', 'be quiet', 'quiet', 'cancel', 'enough', 'pause', 'shut up', 'stop talking', 'silence'], run: () => useChat().stop() },
  { id: 'repeat', help: 'repeat', phrases: ['repeat', 'say that', 'read that', 'what did you say', 'come again', 'repeat that'], run: () => speech.repeat() || speech.say('There is nothing to repeat yet.') },
  { id: 'help', help: 'help', phrases: ['help', 'what can say', 'what can do', 'commands', 'voice commands', 'how does this work'], run: () => {
    const hints = useVoiceCommands().all().map(c => c.help).filter(Boolean)
    speech.say(`You can ask me any question, or say: ${[...new Set(hints)].join(', ')}.`)
  } },
]
useVoiceCommands(commands)

// Voice-first: say where the user is whenever the screen changes.
watch(() => route.path, () => {
  if (voice.consumeQuietNavigation()) return
  const announce = route.meta.announce
  if (announce) speech.say(announce)
})

onMounted(() => {
  updateOnline()
  window.addEventListener('online', updateOnline)
  window.addEventListener('offline', updateOnline)
  voice.init(router)
  speech.init()
  setup.init()
})

onBeforeUnmount(() => {
  window.removeEventListener('online', updateOnline)
  window.removeEventListener('offline', updateOnline)
})
</script>

<template>
  <div class="app">
    <header>
      <img src="/icons/logo.svg" alt="" width="28" height="28">
      <h1>Afronet</h1>
      <span v-if="!online" class="pill">Offline</span>
      <span class="spacer" />
      <button v-if="$pwa?.showInstallPrompt && !$pwa?.isPWAInstalled" class="link" @click="$pwa.install()">
        Install
      </button>
      <button
        v-if="speech.status.value?.available"
        class="icon"
        :aria-label="speech.enabled.value ? 'Turn voice off' : 'Turn voice on'"
        :aria-pressed="speech.enabled.value"
        @click="speech.setEnabled(!speech.enabled.value)"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" />
          <path v-if="speech.enabled.value" d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          <path v-else d="M16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        </svg>
      </button>
    </header>

    <nav class="tabs" aria-label="Screens">
      <NuxtLink to="/" class="tab" active-class="" exact-active-class="active">Chat</NuxtLink>
      <NuxtLink to="/faq" class="tab" active-class="" exact-active-class="active">FAQ</NuxtLink>
      <span class="spacer" />
      <button v-if="route.path === '/' && messages.length && !busy" class="link" @click="clear()">New chat</button>
    </nav>

    <slot />

    <VoiceMic v-if="!route.meta.micInComposer" floating />
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  max-width: 760px;
  margin: 0 auto;
}

header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: calc(8px + env(safe-area-inset-top)) 16px 4px;
}

h1 {
  margin: 0;
  font-size: 1.1rem;
}

.pill {
  padding: 2px 10px;
  border-radius: 999px;
  background: var(--surface);
  color: var(--muted);
  font-size: 0.75rem;
}

.spacer {
  flex: 1;
}

.tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
}

.tab {
  padding: 10px 14px;
  border-bottom: 2px solid transparent;
  color: var(--muted);
  font-size: 0.95rem;
  text-decoration: none;
}

.tab.active {
  border-bottom-color: var(--accent-soft);
  color: var(--text);
  font-weight: 600;
}

.icon {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--accent-soft);
  cursor: pointer;
}

.link {
  min-height: 36px;
  padding: 6px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--accent-soft);
  font-size: 0.9rem;
  cursor: pointer;
}
</style>
