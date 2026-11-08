import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Root from './Root.tsx'
import AuthGate from './AuthGate.tsx'
import { loadFeatures } from './features.ts'

void loadFeatures().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AuthGate>
        <Root />
      </AuthGate>
    </StrictMode>,
  )
})
