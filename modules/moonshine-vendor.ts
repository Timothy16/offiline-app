// Serves @moonshine-ai/moonshine-wasm exactly as published (unminified) from our own origin.
//
// Why not let Vite bundle it: the library builds its AudioWorklet from `downmixToMono.toString()`.
// Minification renames that function, the worklet then calls a name that doesn't exist, throws on
// every audio frame, and the model never hears anything. Loading the original files avoids that
// (it's also how Moonshine's own demo loads them).
//
// Files go to public/vendor/moonshine-wasm@<version>/ — versioned, so cached copies can never be
// stale. The version is checked against the one the app code expects.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { defineNuxtModule } from '@nuxt/kit'
import { MOONSHINE_VERSION } from '../app/lib/voice/moonshine-version'

export default defineNuxtModule({
  meta: { name: 'moonshine-vendor' },
  setup(_options, nuxt) {
    const require = createRequire(import.meta.url)
    // package.json isn't in the package's "exports"; locate it via a public export (dist/moonshine.mjs).
    const distDir = dirname(require.resolve('@moonshine-ai/moonshine-wasm/moonshine.mjs'))
    const pkgDir = dirname(distDir)
    const { version } = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
    if (version !== MOONSHINE_VERSION) {
      throw new Error(`@moonshine-ai/moonshine-wasm is ${version} but the app expects ${MOONSHINE_VERSION}. `
        + 'Update MOONSHINE_VERSION (and re-test the model file list) or reinstall the pinned version.')
    }

    const vendorRoot = join(nuxt.options.rootDir, 'public', 'vendor')
    const outDir = join(vendorRoot, `moonshine-wasm@${version}`)
    rmSync(vendorRoot, { recursive: true, force: true }) // drop other versions
    mkdirSync(outDir, { recursive: true })
    for (const file of readdirSync(distDir)) {
      if (file.endsWith('.map') || file.endsWith('.d.ts')) continue
      copyFileSync(join(distDir, file), join(outDir, file))
    }
  },
})
