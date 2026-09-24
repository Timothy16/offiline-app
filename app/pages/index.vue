<script setup lang="ts">
// Chat screen: header, model setup (first run) or conversation, input bar.
const { $pwa } = useNuxtApp()
const { phase, init } = useLLM()
const { messages, busy, send, stop, clear } = useChat()
const speech = useSpeech()

const draft = ref('')
const online = ref(true)
const ready = computed(() => phase.value === 'ready')
// Once the model is on the device the chat stays visible while it (re)loads.
const showChat = computed(() => ready.value || messages.value.length > 0)

function updateOnline() {
  online.value = navigator.onLine
}

onMounted(() => {
  updateOnline()
  window.addEventListener('online', updateOnline)
  window.addEventListener('offline', updateOnline)
  init()
  speech.init()
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
      <button v-if="messages.length && !busy" class="link" aria-label="Start a new chat" @click="clear()">
        New chat
      </button>
    </header>

    <ChatThread v-if="showChat" :messages="messages" @suggest="draft = $event" />
    <ModelSetup v-else />

    <ChatInput
      v-if="showChat"
      v-model="draft"
      :disabled="!ready"
      :busy="busy || speech.speaking.value"
      @send="send"
      @stop="stop"
    />
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
  padding: calc(10px + env(safe-area-inset-top)) 16px 10px;
  border-bottom: 1px solid var(--border);
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
