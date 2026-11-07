import { useEffect, useState } from 'react'
import { CampusCrowd, FallingCrowd, StoryCrowd } from './components/AmbientCrowd'
import { Icon } from './components/Icons'
import { ScenarioExplorer } from './components/ScenarioExplorer'
import { CampusScene, SkyCorners } from './components/CampusScene'
import { Journey } from './components/Journey'

function Brand() {
  return <a className="brand" href="#top" aria-label="Crowd Control home"><span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /><i /><i /></span>Crowd Control<span className="brand-dot">.</span></a>
}

function App() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(query.matches)
    update(); query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return <>
    <a className="skip-link" href="#scenarios">Skip to scenarios</a>
    <main>
      <Journey>
      <section className="hero" id="top" aria-labelledby="hero-title">
        <header className="navigation"><Brand /><a className="button button-green nav-cta" href="#scenarios">Explore the demo <Icon name="diagonal" size={16} /></a></header>
        <SkyCorners />
        <div className="hero-copy"><h1 id="hero-title">Every crowd has a story.<br /><span>Explore what happens next.</span></h1></div>
        <div className="campus-scene"><CampusScene /><CampusCrowd reduced={reduced} playing /></div>

      </section>
      <section className="story" id="how-it-works" aria-label="How Crowd Control works">
        <StoryCrowd reduced={reduced} playing />
        <article className="story-stop stop-one"><span className="story-symbol green"><Icon name="spark" size={25} /></span><h2>Big ideas.<br />Everyday words.</h2><p>You know your space. You have a question.<br />That’s enough to begin.</p><p>Describe your venue and the people in it. Crowd Control turns natural language into a plan you can explore, whatever your skill level.</p><div className="example-prompt"><span className="prompt-avatar">You</span><span>“A school. 100 students.<br />Let’s run a fire drill.”</span></div></article>
        <article className="story-stop stop-two"><span className="story-symbol blue"><Icon name="school" size={25} /></span><h2>You ask the question.<br /><span>We handle the moving parts.</span></h2><p>From setting up a space to routing its crowd, the system handles the heavy work. You stay focused on what you want to find out.</p><ul className="plain-checks"><li><Icon name="check" size={16} />Describe a space and a scenario</li><li><Icon name="check" size={16} />Review the proposed changes</li><li><Icon name="check" size={16} />Watch the crowd respond</li></ul></article>
        <article className="story-stop stop-three"><span className="story-symbol rose"><Icon name="reset" size={25} /></span><h2>A small change.<br /><span>A different story.</span></h2><p>Close a door. Add a check-in desk. Make a street one-way. Explore how one decision changes the way people move.</p><p>And when a plan needs another look? Edit an earlier intervention and replay the possibilities.</p><a className="text-link" href="#scenarios">Let’s try a few <Icon name="arrow" size={17} /></a></article>
      </section>
      </Journey>
      <div className="crowd-handoff" aria-hidden="true"><span className="handoff-line" /><FallingCrowd reduced={reduced} playing /></div>
      <ScenarioExplorer reduced={reduced} />
      <section className="closing"><span className="closing-people" aria-hidden="true"><i /><i /><i /></span><h2>A little curiosity.<br /><span>A better way forward.</span></h2><p>For the school day, the big night,<br />and everyone in between.</p><a className="button button-green" href="#scenarios">Explore another possibility <Icon name="arrow" size={18} /></a></section>
    </main>
    <footer><Brand /><span>Built with curiosity at HackTrent 2026.</span><a href="https://github.com/samtjhia/crowd-control" target="_blank" rel="noreferrer">View on GitHub <Icon name="diagonal" size={14} /></a><p>Illustrative previews. Planning estimates, not certified safety analysis. Live AI simulation is not connected to this landing page.</p></footer>
  </>
}

export default App
