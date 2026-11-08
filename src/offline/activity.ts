let active = 0
const listeners = new Set<() => void>()
export const activeJobCount = () => active
export const subscribeToJobs = (listener: () => void) => {listeners.add(listener);return () => {listeners.delete(listener)}}
export function beginDocumentJob(): () => void {
  active++;listeners.forEach(listener=>listener())
  let ended=false
  return () => {if(ended)return;ended=true;active--;listeners.forEach(listener=>listener())}
}
