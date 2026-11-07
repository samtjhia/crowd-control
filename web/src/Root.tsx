import { Suspense, lazy } from 'react'
import App from './App.tsx'

// The planner (/planner), history (/history), simulator (/sim), and editor (/editor)
// load on demand so their features stay out of the landing page bundle.
const PlannerApp = lazy(() => import('./PlannerApp.tsx'))
const HistoryApp = lazy(() => import('./HistoryApp.tsx'))
const SimulatorApp = lazy(() => import('./sim/SimulatorApp.tsx'))
const EditorApp = lazy(() => import('./editor/EditorApp.tsx'))

export default function Root() {
  const path = window.location.pathname
  if (path.startsWith('/planner')) return <Suspense fallback={null}><PlannerApp /></Suspense>
  if (path.startsWith('/history')) return <Suspense fallback={null}><HistoryApp /></Suspense>
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
