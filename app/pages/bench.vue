<script setup lang="ts">
// Temporary benchmark: same prompt through each engine config, to pick the V1 runtime.
// Runs one config at a time and disposes it afterwards so memory numbers don't stack up.
import { TransformersEngine } from '~/lib/llm/transformers-engine'
import type { LLMEngine } from '~/lib/llm/types'
import { WllamaEngine } from '~/lib/llm/wllama-engine'

interface Config {
  id: string
  label: string
  create: () => LLMEngine
}

interface Result {
  engine: string
  cachedBefore: boolean
  initMs: number
  firstTextMs: number
  chars: number
  genMs: number
  charsPerSec: number
  memoryMB: number | null
  output: string
}

const PROMPT = 'Explain in three short sentences why the sky is blue.'
const MAX_TOKENS = 128

const env = ref({ isolated: false, cores: 0, deviceMemory: 0, webgpu: 'checking…' })
const configs = ref<Config[]>([
  { id: 'ort-1t', label: 'transformers.js · 1 thread', create: () => new TransformersEngine({ threads: 1 }) },
  { id: 'ort-mt', label: 'transformers.js · multi-thread', create: () => new TransformersEngine() },
  { id: 'llama-cpu', label: 'wllama Q4_K_M · CPU multi-thread', create: () => new WllamaEngine({ gpu: false }) },
])
const statusText = ref<Record<string, string>>({})
const sizes = ref<Record<string, { cached: boolean, bytes: number, variant: string }>>({})
const results = ref<Record<string, Result>>({})
const running = ref<string | null>(null)

const mb = (b: number) => `${Math.round(b / 1_000_000)} MB`

async function measureMemoryMB(): Promise<number | null> {
  const perf = performance as any
  if (!crossOriginIsolated || !perf.measureUserAgentSpecificMemory) return null
  try {
    const res = await Promise.race([
      perf.measureUserAgentSpecificMemory(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 30_000)),
    ])
    return Math.round((res as { bytes: number }).bytes / 1_000_000)
  }
  catch {
    return null
  }
}

async function inspectAll() {
  for (const c of configs.value) {
    const engine = c.create()
    try {
      const s = await engine.inspect()
      sizes.value[c.id] = { cached: s.cached, bytes: s.downloadBytes, variant: `${s.dtype} on ${s.device}` }
    }
    finally {
      await engine.dispose()
    }
  }
}

async function run(c: Config) {
  running.value = c.id
  const say = (t: string) => (statusText.value[c.id] = t)
  const engine = c.create()
  try {
    const s = await engine.inspect()
    say(s.cached ? 'Loading from device…' : `Downloading ${mb(s.downloadBytes)}…`)
    let initStart = performance.now()
    await engine.load((p) => {
      if (p.phase === 'download') {
        say(`Downloading ${mb(p.loaded)} / ${mb(p.total)}`)
        initStart = performance.now()
      }
      else {
        say('Preparing model…')
      }
    })
    const initMs = performance.now() - initStart

    say('Generating…')
    const start = performance.now()
    let first = 0
    let output = ''
    for await (const text of engine.generate([{ role: 'user', content: PROMPT }], { maxNewTokens: MAX_TOKENS })) {
      if (!first) first = performance.now()
      output += text
      say(`Generating… ${output.length} chars`)
    }
    const end = performance.now()

    say('Measuring memory (can take ~20 s)…')
    const memoryMB = await measureMemoryMB()

    const genMs = first ? end - first : 0
    results.value[c.id] = {
      engine: `${s.dtype} on ${s.device}`,
      cachedBefore: s.cached,
      initMs: Math.round(initMs),
      firstTextMs: Math.round(first - start),
      chars: output.length,
      genMs: Math.round(genMs),
      charsPerSec: genMs ? Math.round((output.length / genMs) * 1000 * 10) / 10 : 0,
      memoryMB,
      output,
    }
    sizes.value[c.id] = { cached: true, bytes: 0, variant: `${s.dtype} on ${s.device}` }
    say('Done')
  }
  catch (err) {
    say(`Error: ${err instanceof Error ? err.message : err}`)
  }
  finally {
    await engine.dispose()
    running.value = null
  }
}

onMounted(async () => {
  let webgpu = 'no'
  const gpu = (navigator as any).gpu
  if (gpu) {
    const adapter = await gpu.requestAdapter().catch(() => null)
    webgpu = adapter ? (adapter.features.has('shader-f16') ? 'yes (fp16)' : 'yes (no fp16)') : 'no adapter'
    if (adapter) {
      configs.value.push({ id: 'llama-gpu', label: 'wllama Q4_K_M · WebGPU', create: () => new WllamaEngine({ gpu: true }) })
    }
  }
  env.value = {
    isolated: crossOriginIsolated,
    cores: navigator.hardwareConcurrency,
    deviceMemory: (navigator as any).deviceMemory ?? 0,
    webgpu,
  }
  await inspectAll()
})
</script>

<template>
  <main class="bench">
    <h1>Afronet · runtime benchmark</h1>

    <ul class="status">
      <li>Cross-origin isolated (multi-thread): <strong>{{ env.isolated ? 'yes' : 'NO' }}</strong></li>
      <li>CPU threads: <strong>{{ env.cores }}</strong> · Device memory: <strong>{{ env.deviceMemory ? `${env.deviceMemory} GB` : 'n/a' }}</strong></li>
      <li>WebGPU: <strong>{{ env.webgpu }}</strong></li>
      <li>Prompt: <em>{{ PROMPT }}</em> (max {{ MAX_TOKENS }} tokens)</li>
    </ul>

    <section v-for="c in configs" :key="c.id" class="card">
      <div class="row">
        <div>
          <strong>{{ c.label }}</strong>
          <div class="muted">
            <template v-if="sizes[c.id]">
              {{ sizes[c.id]!.variant }} ·
              {{ sizes[c.id]!.cached ? 'on device' : `needs ${mb(sizes[c.id]!.bytes)} download` }}
            </template>
            <template v-else>checking…</template>
          </div>
        </div>
        <button :disabled="!!running" @click="run(c)">
          {{ sizes[c.id] && !sizes[c.id]!.cached ? 'Download & run' : 'Run' }}
        </button>
      </div>
      <div v-if="statusText[c.id]" class="muted">{{ statusText[c.id] }}</div>
      <table v-if="results[c.id]">
        <tbody>
          <tr><td>Load / prepare</td><td>{{ results[c.id]!.initMs }} ms</td></tr>
          <tr><td>First text after asking</td><td><strong>{{ results[c.id]!.firstTextMs }} ms</strong></td></tr>
          <tr><td>Generation speed</td><td><strong>{{ results[c.id]!.charsPerSec }} chars/s</strong> (~{{ Math.round(results[c.id]!.charsPerSec / 4 * 10) / 10 }} tok/s)</td></tr>
          <tr><td>Output</td><td>{{ results[c.id]!.chars }} chars in {{ results[c.id]!.genMs }} ms</td></tr>
          <tr><td>Page memory</td><td>{{ results[c.id]!.memoryMB != null ? `${results[c.id]!.memoryMB} MB` : 'n/a' }}</td></tr>
        </tbody>
      </table>
      <p v-if="results[c.id]" class="output">{{ results[c.id]!.output }}</p>
    </section>
  </main>
</template>

<style scoped>
.bench {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 680px;
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

.card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: 12px;
  background: var(--surface);
}

.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.muted {
  color: var(--muted);
  font-size: 0.9rem;
}

button {
  flex-shrink: 0;
  padding: 10px 18px;
  border: 0;
  border-radius: 999px;
  background: var(--accent);
  color: var(--accent-text);
  font-size: 0.95rem;
  cursor: pointer;
}

button:disabled {
  opacity: 0.5;
}

table {
  border-collapse: collapse;
  font-size: 0.9rem;
}

td {
  padding: 2px 12px 2px 0;
}

.output {
  margin: 0;
  color: var(--muted);
  font-size: 0.85rem;
  white-space: pre-wrap;
}
</style>
