<script setup lang="ts">
// The one mic button. `floating` = big button at the bottom of screens without an input bar.
defineProps<{ floating?: boolean }>()

const voice = useVoice()
const setup = useSetup()

const label = computed(() => ({
  idle: 'Tap to speak',
  starting: 'Starting the microphone',
  listening: 'Listening — tap to finish',
  finishing: 'Understanding what you said',
}[voice.state.value]))
</script>

<template>
  <div v-if="setup.phase.value === 'ready'" class="mic-wrap" :class="{ floating }">
    <p v-if="floating && voice.caption.value" class="caption" aria-live="polite">{{ voice.caption.value }}</p>
    <button
      type="button"
      class="mic"
      :class="voice.state.value"
      :aria-label="label"
      :disabled="voice.state.value === 'finishing'"
      @click="voice.tap()"
    >
      <span v-if="voice.state.value === 'finishing' || voice.state.value === 'starting'" class="spinner" aria-hidden="true" />
      <svg v-else-if="voice.state.value === 'listening'" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" /></svg>
      <svg v-else viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
        <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.mic-wrap {
  display: contents;
}

.mic-wrap.floating {
  position: fixed;
  left: 0;
  right: 0;
  bottom: calc(20px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  pointer-events: none;
}

.caption {
  max-width: min(90vw, 420px);
  margin: 0;
  padding: 8px 14px;
  border-radius: 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: 0.9rem;
  text-align: center;
}

.mic {
  position: relative;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border: 0;
  border-radius: 50%;
  background: var(--surface);
  color: var(--accent-soft);
  border: 1px solid var(--border);
  cursor: pointer;
  pointer-events: auto;
}

.floating .mic {
  width: 68px;
  height: 68px;
  background: var(--accent);
  color: var(--accent-text);
  border: 0;
  box-shadow: 0 6px 20px rgb(0 0 0 / 0.35);
}

.floating .mic svg {
  width: 30px;
  height: 30px;
}

/* Listening: a pulsing ring, so users see the app is listening (live words show in the caption). */
.mic.listening {
  background: var(--danger-strong);
  color: #fff;
  border-color: transparent;
}

.mic.listening::after {
  content: '';
  position: absolute;
  inset: -4px;
  border-radius: 50%;
  border: 3px solid var(--danger-strong);
  animation: pulse 1.2s ease-out infinite;
}

@keyframes pulse {
  from {
    opacity: 0.7;
    transform: scale(1);
  }
  to {
    opacity: 0;
    transform: scale(1.5);
  }
}

.spinner {
  width: 20px;
  height: 20px;
  border: 3px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
