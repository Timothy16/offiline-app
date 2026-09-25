// The @moonshine-ai/moonshine-wasm version the app is built and tested against. The build copies
// that package into /vendor/moonshine-wasm@<version>/ (modules/moonshine-vendor.ts) and fails if
// the installed version differs, so a dependency update can't slip in untested.
export const MOONSHINE_VERSION = '0.1.5'
export const MOONSHINE_BASE = `/vendor/moonshine-wasm@${MOONSHINE_VERSION}/`
