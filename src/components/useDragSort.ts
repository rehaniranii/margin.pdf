import { useState } from 'react'
import type { DragEvent } from 'react'

export function moveTo<T>(items: T[], from: number, to: number) { const next = items.slice(), [item] = next.splice(from, 1); next.splice(to, 0, item); return next }

// HTML5 drag-and-drop reordering. Buttons stay as the keyboard/touch alternative.
export function useDragSort(onMove: (from: number, to: number) => void) {
  const [dragging, setDragging] = useState<number>(), [over, setOver] = useState<number>()
  const reset = () => { setDragging(undefined); setOver(undefined) }
  return (index: number) => ({
    draggable: true,
    'data-dragging': dragging === index || undefined,
    'data-over': over === index && dragging !== undefined && dragging !== index ? (dragging < index ? 'after' : 'before') : undefined,
    onDragStart: (event: DragEvent) => { setDragging(index); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(index)) },
    // Only our own drags are accepted, so dropped files still reach the drop zone.
    onDragOver: (event: DragEvent) => { if (dragging === undefined) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; if (over !== index) setOver(index) },
    onDrop: (event: DragEvent) => { if (dragging === undefined) return; event.preventDefault(); if (dragging !== index) onMove(dragging, index); reset() },
    onDragEnd: reset,
  })
}
