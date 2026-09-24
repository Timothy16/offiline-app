<script setup lang="ts">
// Message list with streaming reply, auto-scroll (unless the user scrolled up) and an empty state.
import type { ChatEntry } from '~/composables/useChat'
import { renderMarkdown } from '~/lib/markdown'

const props = defineProps<{ messages: readonly Readonly<ChatEntry>[] }>()
const speech = useSpeech()
const canSpeak = computed(() => !!speech.status.value?.available && speech.enabled.value)

function toggleRead(m: Readonly<ChatEntry>) {
  if (speech.speakingId.value === m.id) speech.stop()
  else speech.say(m.content, { id: m.id })
}
const emit = defineEmits<{ suggest: [text: string] }>()

const SUGGESTIONS = [
  'How can I prevent malaria at home?',
  'Give me 3 ideas for a small business',
  'Explain photosynthesis simply',
]

const scroller = ref<HTMLElement | null>(null)
let stickToBottom = true

function onScroll() {
  const el = scroller.value
  if (el) stickToBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
}

// Follow the streaming text, but only if the user hasn't scrolled up to read.
watch(
  () => props.messages.map(m => m.content.length).join(),
  async () => {
    await nextTick()
    const el = scroller.value
    if (el && stickToBottom) el.scrollTop = el.scrollHeight
  },
)
watch(() => props.messages.length, () => (stickToBottom = true))
</script>

<template>
  <div ref="scroller" class="thread" @scroll.passive="onScroll">
    <div v-if="!messages.length" class="empty">
      <p class="hello">Ask me anything.</p>
      <p class="muted">I work offline, right on your phone.</p>
      <div class="chips">
        <button v-for="s in SUGGESTIONS" :key="s" class="chip" @click="emit('suggest', s)">{{ s }}</button>
      </div>
    </div>

    <template v-for="m in messages" :key="m.id">
      <div v-if="m.role === 'user'" class="bubble user">{{ m.content }}</div>
      <div v-else class="bubble assistant" :class="m.state">
        <span v-if="m.state === 'streaming' && !m.content" class="typing" aria-label="Thinking">
          <i /><i /><i />
        </span>
        <template v-else-if="m.state === 'error'">Sorry, I couldn't answer: {{ m.content }}</template>
        <!-- renderMarkdown escapes all HTML before adding formatting tags -->
        <div v-else class="md" v-html="renderMarkdown(m.content)" />
        <small v-if="m.state === 'stopped'" class="note">Stopped</small>
        <button
          v-if="canSpeak && m.content && m.state !== 'streaming' && m.state !== 'error'"
          class="read"
          :aria-label="speech.speakingId.value === m.id ? 'Stop reading' : 'Read aloud'"
          @click="toggleRead(m)"
        >
          <svg v-if="speech.speakingId.value === m.id" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg>
          <svg v-else viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" /><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
          {{ speech.speakingId.value === m.id ? 'Stop' : 'Listen' }}
        </button>
      </div>
    </template>

    <p v-if="messages.length" class="disclaimer">
      Answers come from a small offline AI and can be wrong or out of date.
    </p>
  </div>
</template>

<style scoped>
.thread {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.empty {
  margin: auto 0;
  text-align: center;
}

.hello {
  margin: 0 0 4px;
  font-size: 1.3rem;
  font-weight: 600;
}

.muted {
  margin: 0;
  color: var(--muted);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 20px;
}

.chip {
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: transparent;
  color: var(--text);
  font-size: 0.9rem;
  cursor: pointer;
}

.bubble {
  max-width: 88%;
  padding: 10px 14px;
  border-radius: 18px;
  line-height: 1.5;
  word-break: break-word;
}

.user {
  align-self: flex-end;
  background: var(--accent);
  color: var(--accent-text);
  border-bottom-right-radius: 6px;
  white-space: pre-wrap;
}

.assistant {
  align-self: flex-start;
  background: var(--surface);
  border-bottom-left-radius: 6px;
}

.assistant.error {
  color: var(--danger);
}

.md :deep(p) {
  margin: 0 0 8px;
}

.md :deep(p:last-child),
.md :deep(ul:last-child),
.md :deep(ol:last-child) {
  margin-bottom: 0;
}

.md :deep(ul),
.md :deep(ol) {
  margin: 0 0 8px;
  padding-left: 20px;
}

.md :deep(code) {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--bg);
  font-size: 0.9em;
}

.note {
  display: block;
  margin-top: 4px;
  color: var(--muted);
  font-size: 0.75rem;
}

.read {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  padding: 4px 10px 4px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: transparent;
  color: var(--accent-soft);
  font-size: 0.8rem;
  cursor: pointer;
}

.typing {
  display: inline-flex;
  gap: 4px;
  padding: 4px 0;
}

.typing i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--muted);
  animation: blink 1.2s infinite;
}

.typing i:nth-child(2) {
  animation-delay: 0.2s;
}

.typing i:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes blink {
  0%, 80%, 100% {
    opacity: 0.25;
  }
  40% {
    opacity: 1;
  }
}

.disclaimer {
  margin: 8px 0 0;
  color: var(--muted);
  font-size: 0.75rem;
  text-align: center;
}
</style>
