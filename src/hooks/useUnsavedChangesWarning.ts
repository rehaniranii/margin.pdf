import { useEffect } from 'react'

export function registerUnloadWarning(target: EventTarget): () => void {
  const warn = (event: Event) => {
    event.preventDefault()
    // Browsers choose their own message. The legacy value supports older engines.
    const unload = event as BeforeUnloadEvent
    unload.returnValue = 'Unsaved changes'
  }
  target.addEventListener('beforeunload', warn)
  return () => target.removeEventListener('beforeunload', warn)
}

// Memory-only protection: no document bytes or edit drafts are persisted.
export function useUnsavedChangesWarning(unsaved: boolean) {
  useEffect(() => unsaved ? registerUnloadWarning(window) : undefined, [unsaved])
}
