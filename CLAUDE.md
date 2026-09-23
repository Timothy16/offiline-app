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

- Nuxt 4 (`app/` directory layout), Vue 3, TypeScript
- PWA: `@vite-pwa/nuxt` (Workbox) — manifest + precached app shell
- LLM: `onnx-community/Qwen3-0.6B-ONNX` via `@huggingface/transformers` (transformers.js)
- Runtime: WebGPU when available, fallback to WASM/CPU
- Inference runs in a **Web Worker** so the UI never freezes
- ONNX Runtime `.wasm` files are self-hosted under `/ort/` (copied by `modules/ort-wasm.ts`;
  transformers.js defaults to a CDN, which breaks offline). They are NOT precached by the service
  worker (would cost 14–27 MB on first visit); they download with the model on the user's tap and
  live in the same Cache API store (`transformers-cache`)
- Variants: WebGPU + `shader-f16` → `q4f16` (~606 MB total); otherwise WASM → `q8` (~641 MB).
  An already-cached variant is always preferred, so a browser update never triggers a re-download
- TypeScript is pinned to 5.x (vue-tsc doesn't support TS 6+ yet); `npx nuxt typecheck`

## Design rules

- The model is only reached through the `LLMEngine` interface (`load()` + `generate()`),
  in `app/lib/llm/`. UI and composables never import transformers.js directly. This keeps
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
  components/             Chat UI pieces, model download/progress
  composables/            useLLM (engine state), useChat (messages)
  lib/llm/                LLMEngine interface, transformers.js engine, worker, device detect
  lib/storage.ts          storage.persist() + quota helpers
  lib/voice/              (future) STT/TTS interfaces — not built in V1
public/                   PWA icons, self-hosted ORT wasm
```

## Commands

- `npm run dev` — dev server (service worker is only active in production builds)
- `npm run generate && npm run preview:static` — production static build on :4173 with the
  same COOP/COEP headers as Vercel (`serve.json`); use this to test PWA install, offline, threads
- `/bench` — temporary runtime benchmark page (transformers.js vs wllama)
- WebGPU and service workers need a secure context: `localhost` works; phones need HTTPS
  (deploy to a static host or use a tunnel)

## Deployment

Vercel, static (`vercel.json`: `nuxt generate` → `.output/public`). COOP `same-origin` +
COEP `require-corp` on every response enables `crossOriginIsolated` → multi-threaded WASM.
Hugging Face downloads still work under COEP because they are CORS requests.

## Runtime evaluation (in progress)

transformers.js q8 on WASM measured ~1 tok/s single-thread on an i5-6200U. Candidate CPU path:
llama.cpp via `@wllama/wllama` (`app/lib/llm/wllama-engine.ts`) with
`unsloth/Qwen3-0.6B-GGUF` Q4_K_M (397 MB, stored in OPFS). ONNX q4 (919 MB, fp32 embeddings)
was rejected: too big for 4 GB phones. Import wllama from `@wllama/wllama/esm/index.js`
(its package `main` is broken). On Safari wllama's default "compat" mode loads from a CDN —
must be self-hosted before iOS can work offline.

## Working style

Build step by step; the user tests after each major piece before moving on.
