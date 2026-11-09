// Install support, captured at startup: Chrome/Edge/Android fire beforeinstallprompt once, often
// before any component mounts. iOS has no install API, so it gets Add to Home Screen steps instead.
type PromptEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
export type InstallState = 'available' | 'ios' | 'installed' | 'unavailable'

const standalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
let deferred: PromptEvent | undefined
let state: InstallState = standalone() ? 'installed' : ios ? 'ios' : 'unavailable'
const listeners = new Set<() => void>()
const set = (next: InstallState) => { state = next; listeners.forEach(listener => listener()) }

addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferred = event as PromptEvent; if (!standalone()) set('available') })
addEventListener('appinstalled', () => { deferred = undefined; set('installed') })

export const installState = () => state
export const subscribeToInstall = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
/** Shows the browser's own install dialog. The prompt can be used once; afterwards the browser decides. */
export async function install() {
  const event = deferred
  if (!event) return
  deferred = undefined
  await event.prompt()
  const { outcome } = await event.userChoice
  set(outcome === 'accepted' ? 'installed' : 'unavailable')
}
