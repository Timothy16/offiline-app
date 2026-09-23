// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  // Static SPA: no server at runtime, everything runs on the device.
  ssr: false,

  // Nuxt's app manifest polls /_nuxt/builds/latest.json for new builds; not needed
  // for a static PWA (the service worker handles updates) and it fails offline.
  experimental: { appManifest: false },

  // Plain static output even on Vercel (Nitro would otherwise auto-switch to its Vercel preset),
  // so vercel.json headers and .output/public behave exactly like the local preview.
  nitro: { preset: 'static' },

  modules: ['@vite-pwa/nuxt'],

  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      title: 'Afronet',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'description', content: 'Offline AI assistant that runs on your phone.' },
        { name: 'theme-color', content: '#0f766e' },
      ],
      link: [
        { rel: 'icon', href: '/favicon.ico', sizes: '48x48' },
        { rel: 'icon', href: '/icons/logo.svg', type: 'image/svg+xml' },
        { rel: 'apple-touch-icon', href: '/icons/apple-touch-icon-180x180.png' },
        // In static HTML (not injected at runtime) so browsers detect installability reliably.
        { rel: 'manifest', href: '/manifest.webmanifest' },
      ],
    },
  },

  pwa: {
    registerType: 'autoUpdate',
    manifest: {
      name: 'Afronet',
      short_name: 'Afronet',
      description: 'Offline AI assistant that runs on your phone.',
      lang: 'en',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      orientation: 'portrait',
      theme_color: '#0f766e',
      background_color: '#0b1412',
      icons: [
        { src: '/icons/pwa-64x64.png', sizes: '64x64', type: 'image/png' },
        { src: '/icons/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icons/maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      // Precache the whole app shell so it opens with no network.
      globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
      navigateFallback: '/',
      // llama.cpp runtime (~8 MB): not precached (would cost data on first visit); cached the first
      // time the model loads, which only happens after the user taps Download.
      runtimeCaching: [{
        urlPattern: ({ url }) => url.origin === self.location.origin && url.pathname.endsWith('.wasm'),
        handler: 'CacheFirst',
        options: { cacheName: 'runtime-wasm', expiration: { maxEntries: 4 } },
      }],
      cleanupOutdatedCaches: true,
    },
    client: {
      installPrompt: true,
    },
    // Service worker only in production builds; test offline with `npm run generate`.
    devOptions: { enabled: false },
  },
})
