<template>
  <NuxtRouteAnnouncer />
  <NuxtPage />
</template>

<style>
:root {
  --bg: #0b1412;
  --surface: #13211e;
  --text: #e7efe9;
  --muted: #8fa39c;
  --accent: #0f766e;
  --accent-text: #fef3c7;
  color-scheme: dark;
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  height: 100%;
  background: var(--bg);
  color: var(--text);
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  -webkit-text-size-adjust: 100%;
}

#__nuxt {
  min-height: 100%;
}
</style>
