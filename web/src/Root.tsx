import { Suspense, lazy, useEffect, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { RequireSignIn } from './AuthGate.tsx'
import { navigate } from './site/navigate.ts'

// Each page loads on demand so its features stay out of the others' bundles: the public
// landing page (/ for visitors, /welcome for anyone), past runs (/history, home once signed in), the simulator (/sim), saved floor plans (/plans) and the
// floor-plan editor (/editor), a run's safety report (/report), and developer pages kept
// out of the way under /demo: the original planner (/demo/planner), Conrad's engine test
// page (/demo/engine), and the simulator on the TypeScript mock worker (/demo/mock).
const LandingApp = lazy(() => import('./LandingApp.tsx'))
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

/**
 * The home page: the landing page for visitors, Past runs for anyone signed in. Nothing shows
 * while Auth0 checks (so a signed-in person never sees the landing page flash), including on
 * the way back from signing in, which then continues to where it was going.
 */
function Home() {
  const { isLoading, isAuthenticated, error } = useAuth0()
  const away = !isLoading && (isAuthenticated || error !== undefined)
  useEffect(() => {
    if (away) navigate(`/history${window.location.search}`)
  }, [away])
  if (isLoading || away) return null
  return <Suspense fallback={null}><LandingApp /></Suspense>
}

export default function Root() {
  const path = usePath()
  if (path === '/' || path === '') return <Home />
  // The landing page for anyone, signed in or not (for showing it off while signed in).
  if (path.startsWith('/welcome')) return <Suspense fallback={null}><LandingApp /></Suspense>
  const page = path.startsWith('/demo/planner') ? <PlannerApp />
    : path.startsWith('/history') ? <HistoryApp />
    : path.startsWith('/report') ? <ReportApp />
    : path.startsWith('/plans') ? <PlansApp />
    : path.startsWith('/editor') ? <EditorApp />
    : path.startsWith('/demo/engine') ? <EngineApp />
    : path.startsWith('/demo/mock') ? <SimulatorApp />
    : <SimulatorApp />
  return <RequireSignIn><Suspense fallback={null}>{page}</Suspense></RequireSignIn>
}
