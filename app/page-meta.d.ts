declare module '#app' {
  interface PageMeta {
    /** Spoken when the user arrives on this screen (voice-first: the app says where you are). */
    announce?: string
    /** The screen shows the mic in its own input bar instead of the floating button. */
    micInComposer?: boolean
  }
}

export {}
