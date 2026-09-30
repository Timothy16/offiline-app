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
- Service worker precaches only files < 1 MB (the shell, excluding `/vendor/`); AI runtimes
  (llama.cpp ~8 MB, Moonshine ~13 MB) are runtime-cached (CacheFirst `/_nuxt/` + `/vendor/`) on first
  use, i.e. during setup. vite-plugin-pwa must only *warn* about skipped big files
  (`showMaximumFileSizeToCacheInBytesWarning`), or the Vercel build fails
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
- Voice lives behind small interfaces in `app/lib/voice/` (TTS: `speak`/`stop`; STT:
  `load`/`transcribe`), chosen only in composables — same swappability rule as the LLM.
- Qwen3 "thinking" mode is disabled (`enable_thinking: false`) — saves tokens and time.
- Keep chat history sent to the model short (trim old turns) to bound memory on 4 GB phones.

## Voice spec (V1, English — agreed with the user)

Voice-first app, not "chat with a mic". User tests on desktop after each step, then mobile.
Done: read aloud (built-in voice, fallback forever); FAQ (placeholder questions; V1 screens: Chat,
FAQ); mic on every screen (floating, or in the chat input bar) → speech is a **command** (matched
first, instant, forgiving) or else a **question** sent to the AI and answered aloud — no text box
review; one combined setup download (chat + speech recognition).
Next: AI speed (use the llama.cpp timings now shown under answers) → phone check of memory with
chat + listening + natural voice loaded →
"Hey Afronet" wake word (custom openWakeWord model, opt-in Hands-free mode, only while the app is
open on screen; mic button always stays) → polish (permissions, errors, 4 GB memory).

Speech recognition: **Moonshine Tiny Streaming (English)** via the official
`@moonshine-ai/moonshine-wasm` (MIT, pinned **0.1.5**), model files pinned to
`download.moonshine.ai/model/tiny-streaming-en/quantized_26_07_30/` (51 MB, sizes verified on
download) in Cache Storage `moonshine-models-v1`, runtime 13 MB. Streaming: transcribes while the
user talks; its VAD ends phrases; we join lines until 450 ms without new speech (a pause mid-sentence
must not split "read question … three"). Key terms `FAQ`, `Afronet` fix mishearings ("every kid").
Measured: phone 0.5–0.7 s, desktop 0.1–0.2 s after end of speech (Whisper base.en in WASM: ~74 s —
fixed 30 s window; tested and removed). One `Transcriber` shared; a fresh `MicTranscriber` per turn,
`close()`d after (each start() creates a stream that stop() does not free).
**The library is served unbundled from `/vendor/moonshine-wasm@<version>/`** (copied at build by
`modules/moonshine-vendor.ts`, which fails the build if the installed version ≠ `MOONSHINE_VERSION`).
Never let Vite bundle it: minification renames `downmixToMono`, which its AudioWorklet embeds by
`toString()` → the worklet throws on every frame and hears nothing.
The UI only says "Listening…" after `onReady` (mic really capturing) — words before that are lost.
Setup waits for the service worker to control the page before downloading, or the runtimes fetched
during setup would bypass it and never be cached for offline.
E2E test recipe: headless Chrome with `--use-fake-device-for-media-stream
--use-file-for-fake-audio-capture=<wav>%noloop` (WAVs from Windows SAPI), driven over CDP; use a
SHORT --user-data-dir path (long paths break Cache Storage on Windows).
Commands: `lib/voice/commands.ts` (whole-sentence match, fillers dropped, number words → digits,
1-letter mishearing tolerance); registry `useVoiceCommands` (layout = app-wide, pages add their
own); pages declare `definePageMeta({ announce })` which is spoken on arrival.
Intent order (useVoice.handle): pending yes/no → exact commands → **navigation by meaning** →
**did-you-mean** (`guessNavigation`: navigation-shaped sentence with an unknown/misheard screen —
"go back to church" → "Did you mean the chat?"; unclear → "Where would you like to go?"; NEVER sent
to the AI) → question for the AI. Spoken-letter FAQ spellings ("Effecue", "f a q") normalize to faq.
Acronyms are hard to hear: FAQ also answers to "help". Real mishearings from the user's voice are
in the test suite.
Navigation by meaning (`matchNavigation`): short sentence naming ONE registered screen + a movement
word or screen/page; question-openers like "is/what/how" without screen/page stay questions.
Screens are registered by the layout (`registerScreens`) with specific spoken names and a spoken
`label`. Tests: phrase suites (57 navigation/ending/mishearing + 25 command cases) — rerun after
any matcher change; "show me how to cook rice", "take a photo" must stay questions.
**Conversation mode**: after a voice turn the app waits until it has finished writing and speaking,
then listens again; silence closes it quietly ("done" tone). "thanks/that's all/stop" end it;
typing ends it. Sound cues (`lib/voice/cues.ts`, Web Audio, no files): listening / heard /
not-understood / done. "Are you sure?" is answered on the next conversation turn.
AI tool calling (LLM decides actions) is planned as a fallback but NOT built: in the browser every
token costs ~0.3 s on a slow CPU (llama.cpp prompt reading has no fast WASM matmul), so tool
schemas/calls would add many seconds — measure first.

Natural voice (decided with the user: **100% offline, male British**): Kokoro **George**
(`kokoro_bm_george`, top-graded British male with Fable) via Moonshine TTS, language `en_gb` (uses
the `en_us` G2P files), 10 files / 109 MB from `download.moonshine.ai/tts/` (UNVERSIONED paths →
sizes verified on download; a changed file is rejected and the built-in voice stays).
`lib/voice/moonshine-tts.ts` drives the library's internal `tts-worker-host.js` directly, not its
`TextToSpeech` class: that class's stop() never resolves a pending say(), only say() is off the main
thread, and it keeps extra copies of the voice in memory. Engine: prepare() synthesizes the next
sentence while the current plays; stop() always resolves the playing speak().
Slowness (measured 12–43× real time on a memory-starved laptop) is detected fast: calibration phrase
after load (10 s cap), 4 s limit per sentence (then that sentence is said with the built-in voice),
running average > 1.3. A too-slow device retires the voice (worker closed, memory freed) and skips
loading it for 7 days (`afronet.voice.tooSlowAt`). The built-in voice is ALWAYS the fallback.
Setup: fresh installs download everything in one go (~579 MB: chat 405 + listening 65 + voice 109);
the voice is optional — its failure never fails setup. Existing installs get a non-blocking
"natural voice available" offer (`VoiceOffer.vue`, download only on tap).
Verified in Node with the app's exact files/options: engine loads, 24 kHz audio. NOT yet verified
in a browser (worker path, playback) or on the phone.

Rules: the app speaks **everything** (screen announcements, command confirmations, AI and FAQ
answers); speech is interruptible (mic tap / "stop"); show what was heard on screen (no spoken
"You asked …" echo — user's choice, it delays the answer); "Sorry, I didn't catch that" on empty/unclear; destructive commands ask
"Are you sure?". More languages come later — keep command phrases and voices per-language.

## Future features (not V1)

- Resumable model download (today an interrupted download restarts from 0)
- Custom Afronet voice with an African English accent: record a consenting speaker (1–3 h, clean
  audio, script incl. African names/places), fine-tune a Piper voice (Kokoro has no public training
  code), convert to `.ort`; swap in behind the TTS interface
- Self-host the voice files (the Moonshine TTS CDN paths are unversioned)
- More languages (STT, voices, command phrases), iOS support, lite model for weakest phones
- Wake word with the screen off / app in background (needs a native Android app)

## Layout

```
app/
  app.vue                 root shell
  layouts/default.vue     header, tabs, app-wide voice commands, announcements, floating mic
  pages/index.vue         chat screen
  pages/faq.vue           FAQ (placeholder content), voice: "read question 3"
  pages/bench.vue         temporary runtime benchmark (remove before launch)
  components/             Chat UI pieces, model download/progress
  composables/            useSetup (one download), useLLM, useSTT, useChat, useSpeech (TTS
                          queue), useVoice (mic pipeline), useVoiceCommands (registry)
  lib/llm/                LLMEngine interface + WllamaEngine
  lib/storage.ts          storage.persist() + quota helpers
  lib/voice/              TTS/STT interfaces + engines
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
