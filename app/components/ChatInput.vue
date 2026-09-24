<script setup lang="ts">
// Text box + send/stop. The `leading` slot is where a mic button will go when voice lands.
const props = defineProps<{ disabled?: boolean, busy?: boolean }>()
const emit = defineEmits<{ send: [text: string], stop: [] }>()

const text = defineModel<string>({ default: '' })
const box = ref<HTMLTextAreaElement | null>(null)

// On touch keyboards Enter should add a new line; on desktop Enter sends (Shift+Enter = new line).
const coarsePointer = import.meta.client && matchMedia('(pointer: coarse)').matches

function resize() {
  const el = box.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 140)}px`
}

watch(text, () => nextTick(resize))

function submit() {
  if (props.disabled || props.busy || !text.value.trim()) return
  emit('send', text.value)
  text.value = ''
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !coarsePointer && !e.isComposing) {
    e.preventDefault()
    submit()
  }
}
</script>

<template>
  <form class="composer" @submit.prevent="submit">
    <slot name="leading" />
    <textarea
      ref="box"
      v-model="text"
      rows="1"
      :disabled="disabled"
      :placeholder="disabled ? 'Waiting for the AI…' : 'Ask a question…'"
      aria-label="Your question"
      enterkeyhint="send"
      @keydown="onKeydown"
    />
    <button v-if="busy" type="button" class="round stop" aria-label="Stop answer" @click="emit('stop')">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg>
    </button>
    <button v-else type="submit" class="round" :disabled="disabled || !text.trim()" aria-label="Send">
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
    </button>
  </form>
</template>

<style scoped>
.composer {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 10px 12px calc(10px + env(safe-area-inset-bottom));
  border-top: 1px solid var(--border);
  background: var(--bg);
}

textarea {
  flex: 1;
  min-height: 44px;
  max-height: 140px;
  padding: 11px 14px;
  border: 1px solid var(--border);
  border-radius: 22px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 1rem; /* 16px+ stops iOS zooming on focus */
  line-height: 1.35;
  resize: none;
}

textarea:focus {
  outline: 2px solid var(--accent);
  outline-offset: -1px;
}

.round {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border: 0;
  border-radius: 50%;
  background: var(--accent);
  color: var(--accent-text);
  cursor: pointer;
}

.round:disabled {
  opacity: 0.4;
  cursor: default;
}

.stop {
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
}
</style>
