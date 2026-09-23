// Copies the ONNX Runtime wasm builds that transformers.js needs into public/ort/, so the app
// never depends on a CDN (transformers.js defaults to jsDelivr, which breaks offline use).
// Resolved through transformers.js so the runtime version always matches the library.
import { copyFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { defineNuxtModule } from '@nuxt/kit'

const BUILDS = ['ort-wasm-simd-threaded', 'ort-wasm-simd-threaded.asyncify']

export default defineNuxtModule({
  meta: { name: 'ort-wasm' },
  setup(_options, nuxt) {
    const require = createRequire(import.meta.url)
    const transformersEntry = require.resolve('@huggingface/transformers')
    const ortDist = dirname(createRequire(transformersEntry).resolve('onnxruntime-web'))
    const outDir = join(nuxt.options.rootDir, 'public', 'ort')

    mkdirSync(outDir, { recursive: true })
    for (const build of BUILDS) {
      for (const ext of ['.wasm', '.mjs']) {
        copyFileSync(join(ortDist, build + ext), join(outDir, build + ext))
      }
    }
  },
})
