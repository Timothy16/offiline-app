// Registry of what can be said right now. The layout registers app-wide commands; each screen
// registers its own for as long as it is open. Screen commands are checked first.
import type { VoiceCommand } from '~/lib/voice/commands'

export type RegisteredCommand = VoiceCommand & {
  /** Short spoken hint for "help", e.g. "go to FAQ". */
  help?: string
}

const registered = shallowRef<RegisteredCommand[][]>([])

/** All commands, newest registration (current screen) first. */
function all(): RegisteredCommand[] {
  return registered.value.slice().reverse().flat()
}

/** Register commands for the lifetime of the calling component. */
export function useVoiceCommands(commands?: RegisteredCommand[]) {
  if (commands) {
    registered.value = [...registered.value, commands]
    onScopeDispose(() => {
      registered.value = registered.value.filter(c => c !== commands)
    })
  }
  return { all }
}
