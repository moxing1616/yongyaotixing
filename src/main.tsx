import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './readability.css'

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('/sw.js').catch(() => { /* Settings shows unsupported status. */ })
}
