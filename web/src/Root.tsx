import { Suspense, lazy } from 'react'
import App from './App.tsx'

// The simulator lives at /sim and is loaded on demand, so PixiJS stays out of the landing page bundle.
const SimulatorApp = lazy(() => import('./sim/SimulatorApp.tsx'))

export default function Root() {
  if (!window.location.pathname.startsWith('/sim')) return <App />
  return (
    <Suspense fallback={null}>
      <SimulatorApp />
    </Suspense>
  )
}
