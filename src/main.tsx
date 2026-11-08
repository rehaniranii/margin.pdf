import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import Home from './Home'
import './styles.css'
import { startOfflineDelivery } from './offline/client'
import { OfflineStatus } from './components/OfflineStatus'

// shortcut: hash routing with one route; switch to a router once more tools have pages.
function Root() {
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const onChange = () => { setHash(location.hash); if (location.hash.startsWith('#/')) scrollTo(0, 0) }
    addEventListener('hashchange', onChange)
    return () => removeEventListener('hashchange', onChange)
  }, [])
  return <><OfflineStatus/>{hash.split('?')[0] === '#/edit' ? <App/> : <Home/>}</>
}

startOfflineDelivery()
createRoot(document.getElementById('root')!).render(<Root/>)
