# Afronet

Offline-first app for African users. Nuxt 4 installable PWA that runs a small LLM
entirely in the browser. No server, no internet after first load.

## V1 goal

User installs the app → goes fully offline → asks the AI a question → gets a streamed
answer, computed locally on the device.

## Hard constraints

- **Floor device: low-end 4 GB Android phone.** Keep bundle, memory and CPU light.
  Every dependency must justify its weight.
- **No backend.** Static build only (`nuxt generate`, `ssr: false`). Nothing may call a
  server at runtime except the one-time model download.
- **Works offline after first load.** App shell precached by a service worker; model
  weights cached in persistent browser storage; `navigator.storage.persist()` requested.
- **Data is expensive.** Never start the large model download without an explicit user tap
  that shows the download size. Downloads must survive being cached once and reused.

## Stack (decided)

- Nuxt 4 (`app/` directory layout), Vue 3, TypeScript, static SPA (`ssr: false`, Nitro preset `static`)
- PWA: `@vite-pwa/nuxt` (Workbox) — manifest + precached app shell
- LLM: **Qwen3-0.6B Q4_K_M GGUF** (`unsloth/Qwen3-0.6B-GGUF`, pinned commit, 397 MB) run by
  **llama.cpp via `@wllama/wllama`** on CPU, multi-threaded. wllama runs its own worker and stores
  the model in OPFS. Import from `@wllama/wllama/esm/index.js` (its package `main` is broken)
- llama.cpp `wllama.wasm` (~8 MB) is bundled by Vite and runtime-cached by the service worker on
  first use (not precached — would cost data on first visit)
- WebGPU is available in wllama (`gpu: true`) but off by default: +12% on a laptop iGPU and
  unreliable drivers on low-end Android. Revisit after phone benchmarks
- TypeScript is pinned to 5.x (vue-tsc doesn't support TS 6+ yet); `npx nuxt typecheck`

### Why not transformers.js (tested and removed)

Benchmark on an i5-6200U (2 cores/4 threads, 8 GB), same prompt:
transformers.js ONNX q8 (641 MB): 2.3 tok/s single-thread, 2.8 multi-thread, **2.4 GB page memory**.
wllama Q4_K_M (405 MB incl. wasm): 4.6 tok/s CPU, 5.2 tok/s WebGPU, loads in ~12 s.
ONNX q4 (919 MB) rejected: fp32 embedding table, too big for 4 GB phones.

## Design rules

- The model is only reached through the `LLMEngine` interface (`load()` + `generate()`),
  in `app/lib/llm/`. UI and components never import wllama directly — only `useLLM` picks the engine. This keeps
  the model/runtime swappable.
- Voice (STT/TTS) comes later behind the same style of interface (`app/lib/voice/`).
  **Do not build voice yet**, but don't make choices that block it (e.g. keep the worker
  and engine generic, keep chat state independent of input method).
- Qwen3 "thinking" mode is disabled (`enable_thinking: false`) — saves tokens and time.
- Keep chat history sent to the model short (trim old turns) to bound memory on 4 GB phones.

## Layout

```
app/
  app.vue                 root shell
  pages/index.vue         chat screen
  pages/bench.vue         temporary runtime benchmark (remove before launch)
  components/             Chat UI pieces, model download/progress
  composables/            useLLM (engine state), useChat (messages)
  lib/llm/                LLMEngine interface + WllamaEngine
  lib/storage.ts          storage.persist() + quota helpers
  lib/voice/              (future) STT/TTS interfaces — not built in V1
public/                   PWA icons
```

## Commands

- `npm run dev` — dev server (service worker is only active in production builds)
- `npm run generate && npm run preview:static` — production static build on :4173 with the
  same COOP/COEP headers as Vercel (`serve.json`); use this to test PWA install, offline, threads
- `/bench` — temporary runtime benchmark (wllama CPU vs WebGPU); use it on real phones
- WebGPU and service workers need a secure context: `localhost` works; phones need HTTPS
  (deploy to a static host or use a tunnel)

## Deployment

Vercel, static (`vercel.json`: `nuxt generate` → `.output/public`). COOP `same-origin` +
COEP `require-corp` on every response enables `crossOriginIsolated` → multi-threaded WASM.
Hugging Face downloads still work under COEP because they are CORS requests.

## Known follow-ups

- iOS: wllama's Safari "compat" mode loads worker/wasm from a CDN by default — self-host it
  before iOS can work offline. iOS users must "Add to Home Screen" (7-day eviction otherwise)
- Verify the wllama wasm is served from the SW cache when fully offline (step 6)
- Measure wllama memory on a real 4 GB Android phone

## Working style

Build step by step; the user tests after each major piece before moving on.
