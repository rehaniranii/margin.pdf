import { useState } from 'react'

type Props = { label: string; hint?: string; accept: string; multiple?: boolean; disabled?: boolean; compact?: boolean; onFiles: (files: File[]) => void }

// Dropped files bypass the input's `accept`, so filter them the same way here.
function matches(file: File, accept: string) {
  return accept.split(',').some(rule => rule.startsWith('.') ? file.name.toLowerCase().endsWith(rule) : file.type === rule)
}

export function DropZone({ label, hint, accept, multiple, disabled, compact, onFiles }: Props) {
  const [over, setOver] = useState(false)
  const [rejected, setRejected] = useState(false)
  function take(list: FileList | null) {
    const files = Array.from(list ?? []).filter(file => matches(file, accept)).slice(0, multiple ? undefined : 1)
    setRejected(!!list?.length && !files.length)
    if (files.length) onFiles(files)
  }
  return <label className={`drop-zone${over ? ' over' : ''}${compact ? ' compact' : ''}${disabled ? ' disabled' : ''}`}
    onDragOver={event => { event.preventDefault(); if (!disabled) setOver(true) }}
    onDragLeave={() => setOver(false)}
    onDrop={event => { event.preventDefault(); setOver(false); if (!disabled) take(event.dataTransfer.files) }}>
    <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M14 6h14l8 8v28H14z"/><path d="M28 6v8h8"/><path className="arrow" d="M25 34V21M20 26l5-5 5 5"/></svg>
    <strong>{label}</strong>
    {hint && <span>{hint}</span>}
    {rejected && <span className="drop-error" role="alert">That file type is not supported here.</span>}
    <input type="file" accept={accept} multiple={multiple} disabled={disabled} onChange={event => { take(event.target.files); event.target.value = '' }}/>
  </label>
}
