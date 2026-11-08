import { Suspense, lazy, useEffect, useState } from 'react'
import { navigate } from './site/navigate.ts'

// Each page loads on demand so its features stay out of the others' bundles: the simulator
// (/sim, also the home page), floor-plan editor (/editor), past runs (/history), a run's safety
// report (/report), the
// original planner page (/planner, reachable by URL), and Conrad's engine test page (/engine).
const PlannerApp = lazy(() => import('./PlannerApp.tsx'))
const HistoryApp = lazy(() => import('./HistoryApp.tsx'))
const ReportApp = lazy(() => import('./ReportApp.tsx'))
const SimulatorApp = lazy(() => import('./sim/SimulatorApp.tsx'))
const EditorApp = lazy(() => import('./editor/EditorApp.tsx'))
const EngineApp = lazy(() => import('./App.tsx'))

/** The current path, kept up to date when sign-in (or anything else) navigates without a reload. */
function usePath() {
  const [path, setPath] = useState(window.location.pathname)
  useEffect(() => {
    const update = () => setPath(window.location.pathname)
    window.addEventListener('popstate', update)
    return () => window.removeEventListener('popstate', update)
  }, [])
  return path
}

export default function Root() {
  const path = usePath()
  const home = path === '/' || path === ''
  useEffect(() => {
    if (home) navigate(`/sim${window.location.search}`)
  }, [home])
  if (home) return null
  const page = path.startsWith('/planner') ? <PlannerApp />
    : path.startsWith('/history') ? <HistoryApp />
    : path.startsWith('/report') ? <ReportApp />
    : path.startsWith('/editor') ? <EditorApp />
    : path.startsWith('/engine') ? <EngineApp />
    : <SimulatorApp />
  return <Suspense fallback={null}>{page}</Suspense>
}
