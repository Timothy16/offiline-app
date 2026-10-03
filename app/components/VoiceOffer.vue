<script setup lang="ts">
// Offers the natural voice to people who set the app up before it existed. Never blocks the app:
// the built-in voice keeps working, and the download only starts on a tap (data is expensive).
const setup = useSetup()

const DISMISS_KEY = 'afronet.voiceOffer.dismissed'
const dismissed = ref(false)

const mb = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`
const percent = computed(() => {
  const p = setup.voiceProgress.value
  return p.total ? Math.min(100, Math.floor((p.loaded / p.total) * 100)) : 0
})
const working = computed(() => setup.voicePhase.value === 'downloading' || setup.voicePhase.value === 'initializing')
const tooSlow = computed(() => setup.voicePhase.value === 'too-slow')
const visible = computed(() =>
  setup.phase.value === 'ready'
  && (working.value || ((setup.voiceBytes.value > 0 || tooSlow.value) && !dismissed.value)),
)

// "Hear it anyway": proves the natural voice works here and shows how slow it is (it needs to
// make speech faster than it plays — under 1× — for conversation).
const speech = useSpeech()
const previewing = ref(false)
const previewText = ref('')
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`

async function preview() {
  previewing.value = true
  try {
    const { synthMs, audioMs } = await speech.previewNatural()
    previewText.value = `Natural voice works: ${seconds(synthMs)} to make ${seconds(audioMs)} of speech `
      + `(${(synthMs / audioMs).toFixed(1)}× — needs under 1.3× for conversation).`
  }
  catch (err) {
    console.warn('[afronet] natural voice preview failed:', err)
    previewText.value = `The natural voice failed to play: ${err instanceof Error ? err.message : err}`
  }
  finally {
    previewing.value = false
  }
}

function dismiss() {
  dismissed.value = true
  try {
    localStorage.setItem(DISMISS_KEY, '1')
  }
  catch {}
}

onMounted(() => {
  try {
    dismissed.value = localStorage.getItem(DISMISS_KEY) === '1'
  }
  catch {}
})
</script>

<template>
  <aside v-if="visible" class="offer" aria-live="polite">
    <template v-if="setup.voicePhase.value === 'downloading'">
      <span>Downloading natural voice… {{ percent }}%</span>
      <div class="bar" role="progressbar" :aria-valuenow="percent" aria-valuemin="0" aria-valuemax="100">
        <div :style="{ width: `${percent}%` }" />
      </div>
    </template>
    <span v-else-if="setup.voicePhase.value === 'initializing'">Preparing natural voice…</span>
    <template v-else-if="tooSlow">
      <span>{{ previewText || "The natural voice is too slow on this device, so the phone's voice is used." }}</span>
      <span class="actions">
        <button class="link" :disabled="previewing" @click="preview()">
          {{ previewing ? 'Preparing…' : 'Hear it anyway' }}
        </button>
        <button class="link" @click="dismiss()">OK</button>
      </span>
    </template>
    <template v-else>
      <span>
        {{ setup.voicePhase.value === 'error' ? 'The natural voice could not be downloaded.' : 'A natural voice is available.' }}
      </span>
      <span class="actions">
        <button class="primary" @click="setup.downloadVoice()">
          {{ setup.voicePhase.value === 'error' ? 'Try again' : 'Download' }} ({{ mb(setup.voiceBytes.value) }})
        </button>
        <button class="link" @click="dismiss()">Not now</button>
      </span>
    </template>
  </aside>
</template>

<style scoped>
.offer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 12px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  font-size: 0.9rem;
}

.actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.primary {
  min-height: 36px;
  padding: 6px 14px;
  border: 0;
  border-radius: 999px;
  background: var(--accent);
  color: var(--accent-text);
  font-size: 0.9rem;
  cursor: pointer;
}

.link {
  min-height: 36px;
  padding: 6px 10px;
  border: 0;
  background: transparent;
  color: var(--muted);
  font-size: 0.9rem;
  cursor: pointer;
}

.bar {
  flex-basis: 100%;
  height: 6px;
  border-radius: 3px;
  background: var(--bg);
  overflow: hidden;
}

.bar div {
  height: 100%;
  background: var(--accent);
  transition: width 0.3s;
}
</style>
