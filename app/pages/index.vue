<script setup lang="ts">
// Chat screen: first-run setup, or the conversation with the mic + text input.
definePageMeta({
  announce: 'Chat. Tap the mic and ask me anything.',
  micInComposer: true,
})

const setup = useSetup()
const voice = useVoice()
const speech = useSpeech()
const { messages, busy, send, stop } = useChat()

const draft = ref('')
const ready = computed(() => setup.phase.value === 'ready')
// Once there is a conversation it stays visible while the models (re)load.
const showChat = computed(() => ready.value || messages.value.length > 0)

function readLastAnswer() {
  const last = [...messages.value].reverse().find(m => m.role === 'assistant' && m.content && m.state !== 'error')
  if (last) speech.say(last.content, { id: last.id })
  else speech.say('There is no answer to read yet. Tap the mic and ask me something.')
}

useVoiceCommands([
  { id: 'read-answer', help: 'read the answer', phrases: ['read answer', 'read last answer', 'read that answer', 'read it'], run: readLastAnswer },
])
</script>

<template>
  <ChatThread v-if="showChat" :messages="messages" @suggest="draft = $event" />
  <ModelSetup v-else />

  <p v-if="showChat && voice.caption.value" class="caption" aria-live="polite">{{ voice.caption.value }}</p>
  <ChatInput
    v-if="showChat"
    v-model="draft"
    :disabled="!ready"
    :busy="busy || speech.speaking.value"
    @send="send"
    @stop="stop"
  >
    <template #leading>
      <VoiceMic />
    </template>
  </ChatInput>
</template>

<style scoped>
.caption {
  margin: 0;
  padding: 6px 16px;
  color: var(--muted);
  font-size: 0.85rem;
  text-align: center;
}
</style>
