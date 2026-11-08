import { useEffect, useState, type ReactNode } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import './landing.css'
import { CampusCrowd, StoryCrowd } from './components/AmbientCrowd'
import { Icon } from './components/Icons'
import { ScenarioExplorer } from './components/ScenarioExplorer'
import { CampusScene } from './components/CampusScene'
import { SkySimulation } from './components/SkySimulation'
import { OperationsPavilion, DecisionGarden } from './components/StoryLocations'
import { CampusPlaza } from './components/CampusPlaza'
import { CityScenery } from './components/CityScenery'
import { RoadmapHandoff } from './components/RoadmapHandoff'
import { Journey } from './components/Journey'
import { useTextEntrances } from './components/useTextEntrances'
import { WhyItMatters } from './components/WhyItMatters'

function Brand() {
  return <a className="brand" href="#top" aria-label="Crowd Control home"><span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /><i /><i /></span>Crowd Control<span className="brand-dot">.</span></a>
}

/**
 * A way into the app at `to`: a link once signed in; otherwise a button that signs in first
 * and then carries on there.
 */
function IntoApp({ to, className, children }: { to: string; className: string; children: ReactNode }) {
  const { isAuthenticated, loginWithRedirect } = useAuth0()
  if (isAuthenticated) return <a className={className} href={to}>{children}</a>
  return <button type="button" className={className} onClick={() => void loginWithRedirect({ appState: { returnTo: to } })}>{children}</button>
}

/** The public landing page (Benito's): what Crowd Control does, with a way into the app. */
function LandingApp() {
  const textEntrances = useTextEntrances()
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(query.matches)
    update(); query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return <div className="landing">
    <a className="skip-link" href="#scenarios">Skip to scenarios</a>
    <main ref={textEntrances}>
      <Journey reduced={reduced}>
      <section className="hero" id="top" aria-labelledby="hero-title">
        <header className="navigation"><Brand /></header>
        <SkySimulation reduced={reduced} />
        <div className="hero-copy"><h1 id="hero-title">Simulate Any <span>Crowd.</span></h1><p>Describe a scenario. See what happens.</p><IntoApp to="/sim" className="button button-green hero-primary">Explore the demo <Icon name="arrow" size={19} /></IntoApp></div>
        <div className="campus-scene"><CampusScene /><CampusCrowd reduced={reduced} playing /></div>

      </section>
      <section className="story" id="how-it-works" aria-label="How Crowd Control works">
        <CityScenery /><StoryCrowd reduced={reduced} playing />
        <CampusPlaza reduced={reduced} />
        <OperationsPavilion reduced={reduced} />
        <DecisionGarden reduced={reduced} />
      </section>
      <div className="crowd-handoff"><RoadmapHandoff reduced={reduced} /></div>
      </Journey>
      <WhyItMatters reduced={reduced} />
      <ScenarioExplorer reduced={reduced} />
      <section className="closing" aria-labelledby="closing-title">
        <h2 id="closing-title">Try a different setup.</h2>
        <div className="closing-copy">
          <p>Switch settings and customize the layout, crowd size, and exits to test different scenarios.</p>
          <a className="text-link closing-link" href="#scenarios">Try it out <Icon name="arrow" size={20} /></a>
        </div>
      </section>
    </main>
    <footer><Brand /><span>HackTrent 2026.</span><a href="https://github.com/samtjhia/crowd-control" target="_blank" rel="noreferrer">View on GitHub <Icon name="diagonal" size={14} /></a><p>Illustrative previews. Planning estimates, not certified safety analysis. Live AI simulation is not connected to this landing page.</p></footer>
  </div>
}

export default LandingApp
