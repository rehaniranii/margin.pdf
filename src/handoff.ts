// Passes a file the user chose on one page to the next page, in memory only (never stored).
type HandOff = { file: File; hasLocalCopy: boolean }
let pending: HandOff | undefined
export const handOff = (file: File, hasLocalCopy = true) => { pending = { file, hasLocalCopy } }
export const takeHandOff = () => { const value = pending; pending = undefined; return value }
