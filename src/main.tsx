import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import Home from './Home'
import ToolPage from './ToolPage'
import { findTool } from './tools'
import './theme'
import './tokens.css'
import './styles.css'
import { startOfflineDelivery } from './offline/client'
import { OfflineStatus } from './components/OfflineStatus'

// shortcut: hash routing (#/edit, #/<tool>, #/#section); switch to a router if routes grow past a flat list.
function Root() {
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const onChange = () => setHash(location.hash)
    addEventListener('hashchange', onChange)
    return () => removeEventListener('hashchange', onChange)
  }, [])
  const [route, section] = hash.slice(2).split('?')[0].split('#')
  useEffect(() => {
    const target = section && document.getElementById(section)
    if (target) target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    else if (hash.startsWith('#/')) scrollTo(0, 0)
  }, [hash])
  const tool = findTool(route)
  return <><OfflineStatus/>{route === 'edit' ? <App/> : tool ? <ToolPage tool={tool}/> : <Home/>}</>
}

startOfflineDelivery()
createRoot(document.getElementById('root')!).render(<Root/>)
