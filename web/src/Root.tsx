import { Suspense, lazy, useEffect, useState } from 'react'
import { navigate } from './site/navigate.ts'

// Each page loads on demand so its features stay out of the others' bundles: past runs
// (/history, also the home page), the simulator (/sim), saved floor plans (/plans) and the
// floor-plan editor (/editor), a run's safety report (/report), and two developer pages kept
// out of the way under /demo: the original planner (/demo/planner) and Conrad's engine test
// page (/demo/engine).
const PlannerApp = lazy(() => import('./PlannerApp.tsx'))
const HistoryApp = lazy(() => import('./HistoryApp.tsx'))
const PlansApp = lazy(() => import('./PlansApp.tsx'))
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
    if (home) navigate(`/history${window.location.search}`)
  }, [home])
  if (home) return null
  const page = path.startsWith('/demo/planner') ? <PlannerApp />
    : path.startsWith('/history') ? <HistoryApp />
    : path.startsWith('/report') ? <ReportApp />
    : path.startsWith('/plans') ? <PlansApp />
    : path.startsWith('/editor') ? <EditorApp />
    : path.startsWith('/demo/engine') ? <EngineApp />
    : <SimulatorApp />
  return <Suspense fallback={null}>{page}</Suspense>
}
