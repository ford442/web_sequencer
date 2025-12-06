import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { WebGPUProvider } from './gpu/WebGPUContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WebGPUProvider>
      <App />
    </WebGPUProvider>
  </StrictMode>,
)
