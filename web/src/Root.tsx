import { Suspense, lazy } from 'react'
import App from './App.tsx'

// The planner (/planner), simulator (/sim) and floor-plan editor (/editor) load on demand,
// so PixiJS, the planner and the editor stay out of the landing page bundle.
const PlannerApp = lazy(() => import('./PlannerApp.tsx'))
const SimulatorApp = lazy(() => import('./sim/SimulatorApp.tsx'))
const EditorApp = lazy(() => import('./editor/EditorApp.tsx'))

export default function Root() {
  const path = window.location.pathname
  if (path.startsWith('/planner')) return <Suspense fallback={null}><PlannerApp /></Suspense>
  if (path.startsWith('/editor')) {
    return (
      <Suspense fallback={null}>
        <EditorApp />
      </Suspense>
    )
  }
  if (!path.startsWith('/sim')) return <App />
  return (
    <Suspense fallback={null}>
      <SimulatorApp />
    </Suspense>
  )
}
