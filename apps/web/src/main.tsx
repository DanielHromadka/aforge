import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './monaco'
import './styles.css'
import './walkthrough.css'
import './git.css'
import './ide.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
