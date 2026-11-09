import { useEffect } from 'react'

// How many unsaved-work warnings are active; an app update must not reload over them.
let unsaved = 0
export const unsavedCount = () => unsaved

export function registerUnloadWarning(target: EventTarget): () => void {
  const warn = (event: Event) => {
    event.preventDefault()
    // Browsers choose their own message. The legacy value supports older engines.
    const unload = event as BeforeUnloadEvent
    unload.returnValue = 'Unsaved changes'
  }
  target.addEventListener('beforeunload', warn); unsaved++
  return () => { target.removeEventListener('beforeunload', warn); unsaved-- }
}

// Memory-only protection: no document bytes or edit drafts are persisted.
export function useUnsavedChangesWarning(unsaved: boolean) {
  useEffect(() => unsaved ? registerUnloadWarning(window) : undefined, [unsaved])
}
