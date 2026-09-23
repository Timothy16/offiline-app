<script setup lang="ts">
// Step 4 test bench: proves download → cache → WebGPU/WASM inference → streaming.
// The real chat UI replaces this in step 5.
const { phase, status, progress, error, persisted, init, load, generate } = useLLM()

const online = ref(true)
const prompt = ref('Explain in two sentences why the sky is blue.')
const output = ref('')
const busy = ref(false)
const timing = ref<{ firstChunkMs: number, totalMs: number, chunks: number } | null>(null)
const controller = shallowRef<AbortController | null>(null)

const mb = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`
const percent = computed(() =>
  progress.value.total ? Math.min(100, Math.round((progress.value.loaded / progress.value.total) * 100)) : 0,
)

async function ask() {
  busy.value = true
  output.value = ''
  controller.value = new AbortController()
  const start = performance.now()
  let first = 0
  let chunks = 0
  try {
    for await (const text of generate([{ role: 'user', content: prompt.value }], { signal: controller.value.signal })) {
      if (!first) first = performance.now() - start
      chunks++
      output.value += text
    }
  }
  catch (err) {
    output.value += `\n[error: ${err instanceof Error ? err.message : err}]`
  }
  finally {
    timing.value = { firstChunkMs: Math.round(first), totalMs: Math.round(performance.now() - start), chunks }
    busy.value = false
  }
}

function updateOnline() {
  online.value = navigator.onLine
}

onMounted(() => {
  updateOnline()
  window.addEventListener('online', updateOnline)
  window.addEventListener('offline', updateOnline)
  init()
})

onBeforeUnmount(() => {
  window.removeEventListener('online', updateOnline)
  window.removeEventListener('offline', updateOnline)
})
</script>

<template>
  <main class="bench">
    <h1>Afronet · engine test</h1>

    <ul class="status">
      <li>Network: <strong>{{ online ? 'online' : 'offline' }}</strong></li>
      <li>Engine: <strong>{{ phase }}</strong></li>
      <li v-if="status">
        Model: <strong>{{ status.model }} · {{ status.dtype }} on {{ status.device }}</strong>
      </li>
      <li v-if="status">Stored on device: <strong>{{ status.cached ? 'yes' : 'no' }}</strong></li>
      <li v-if="persisted !== null">Persistent storage: <strong>{{ persisted ? 'granted' : 'not granted' }}</strong></li>
    </ul>

    <button v-if="phase === 'needs-download' && status" @click="load()">
      Download model ({{ mb(status.downloadBytes) }})
    </button>

    <div v-if="phase === 'downloading'" class="progress">
      <div class="bar"><div :style="{ width: `${percent}%` }" /></div>
      <small>{{ mb(progress.loaded) }} / {{ mb(progress.total) }} · {{ percent }}%</small>
    </div>
    <p v-if="phase === 'initializing'">Preparing model…</p>
    <p v-if="error" class="error">{{ error }}</p>

    <section v-if="phase === 'ready'" class="ask">
      <textarea v-model="prompt" rows="3" />
      <div class="row">
        <button :disabled="busy || !prompt.trim()" @click="ask()">Ask</button>
        <button v-if="busy" class="secondary" @click="controller?.abort()">Stop</button>
      </div>
      <pre class="output">{{ output }}</pre>
      <small v-if="timing">
        first text {{ timing.firstChunkMs }} ms · total {{ timing.totalMs }} ms · {{ timing.chunks }} chunks
      </small>
    </section>
  </main>
</template>

<style scoped>
.bench {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 640px;
  margin: 0 auto;
  padding: 24px 16px;
}

h1 {
  margin: 0;
  font-size: 1.25rem;
}

.status {
  list-style: none;
  padding: 0;
  margin: 0;
  color: var(--muted);
  line-height: 1.8;
}

.status strong {
  color: var(--text);
}

button {
  padding: 12px 20px;
  border: 0;
  border-radius: 999px;
  background: var(--accent);
  color: var(--accent-text);
  font-size: 1rem;
  cursor: pointer;
}

button:disabled {
  opacity: 0.5;
}

button.secondary {
  background: var(--surface);
  color: var(--text);
}

.progress .bar {
  height: 8px;
  border-radius: 4px;
  background: var(--surface);
  overflow: hidden;
}

.progress .bar div {
  height: 100%;
  background: var(--accent);
  transition: width 0.2s;
}

.error {
  color: #fca5a5;
}

.ask {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.row {
  display: flex;
  gap: 8px;
}

textarea {
  width: 100%;
  padding: 12px;
  border: 1px solid var(--surface);
  border-radius: 12px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
}

.output {
  min-height: 4em;
  margin: 0;
  padding: 12px;
  border-radius: 12px;
  background: var(--surface);
  white-space: pre-wrap;
  font: inherit;
}
</style>
