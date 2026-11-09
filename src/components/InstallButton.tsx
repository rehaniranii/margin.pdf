import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { install, installState, subscribeToInstall } from '../install'

// One click on Chrome/Edge/Android; Add to Home Screen steps on iPhone/iPad; hidden where installing
// is impossible (e.g. Firefox desktop) or already done.
// className/label let the editor header match its own buttons.
export function InstallButton({ className = 'install-button', label = 'Install app' }: { className?: string; label?: string }) {
  const state = useSyncExternalStore(subscribeToInstall, installState)
  const [steps, setSteps] = useState(false), panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!steps) return
    const close = (event: KeyboardEvent | PointerEvent) => { if (event instanceof KeyboardEvent ? event.key === 'Escape' : !panel.current?.parentElement?.contains(event.target as Node)) setSteps(false) }
    addEventListener('keydown', close); addEventListener('pointerdown', close)
    return () => { removeEventListener('keydown', close); removeEventListener('pointerdown', close) }
  }, [steps])
  if (state === 'available') return <button className={className} title="Install margin.pdf as an app" onClick={() => void install()}>{label}</button>
  if (state !== 'ios') return null
  return <span className="install-wrap">
    <button className={className} title="Install margin.pdf as an app" aria-expanded={steps} onClick={() => setSteps(!steps)}>{label}</button>
    {steps && <div className="install-steps" ref={panel} role="dialog" aria-label="Install on iPhone or iPad">
      <ol><li>Tap the <strong>Share</strong> button <span aria-hidden="true">(square with an arrow)</span> in Safari.</li><li>Choose <strong>Add to Home Screen</strong>.</li><li>Tap <strong>Add</strong>. margin.pdf then opens like an app and works offline.</li></ol>
    </div>}
  </span>
}
