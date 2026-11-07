import { useRef, useState } from 'react'
import { Icon, type IconName } from './Icons'
import { ScenarioCanvas, type ScenarioId } from './ScenarioCanvas'

const SCENARIOS: { id: ScenarioId; title: string; description: string; icon: IconName; prompt: string; result: string; original: string; changed: string }[] = [
  { id: 'school', title: 'The school day', description: 'Classrooms, corridors, and a way out.', icon: 'school', prompt: 'What if the east exit closes?', result: 'One less exit. People reroute west, and the corridor gets busier.', original: 'Both exits open', changed: 'East exit closed' },
  { id: 'concert', title: 'The encore', description: 'A whole audience. One final song.', icon: 'concert', prompt: 'What if everyone leaves after the show?', result: 'The audience becomes two moving streams, heading for the exits.', original: 'The show is on', changed: 'The crowd is leaving' },
  { id: 'checkin', title: 'The first hello', description: 'Big ideas start at the check-in desk.', icon: 'checkin', prompt: 'What if we add another check-in desk?', result: 'Arrivals spread across five desks instead of four.', original: 'Four desks open', changed: 'Five desks open' },
  { id: 'alley', title: 'The narrow street', description: 'Two directions. Not much room.', icon: 'alley', prompt: 'What if this alley becomes one-way?', result: 'The opposing streams become a single flow toward the station.', original: 'Two-way traffic', changed: 'One-way traffic' },
]

export function ScenarioExplorer({ reduced }: { reduced: boolean }) {
  const [selected, setSelected] = useState(0)
  const [changed, setChanged] = useState(false)
  const [playing, setPlaying] = useState(true)
  const [reset, setReset] = useState(0)
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const scenario = SCENARIOS[selected]
  const choose = (index: number) => { setSelected(index); setChanged(false); setPlaying(true); setReset(value => value + 1) }
  return <section className="explore-section" id="scenarios" aria-labelledby="explore-title">
    <div className="section-heading"><h2 id="explore-title">Different spaces.<br /><span>The same curiosity.</span></h2><p>Pick a place. Watch the people.<br />Then change one little thing.</p></div>
    <div className="scenario-workbench">
      <div className="scenario-sidebar">
        <div className="scenario-tabs" role="tablist" aria-label="Choose a scenario" aria-orientation="vertical">
          {SCENARIOS.map((item, index) => <button key={item.id} role="tab" id={`tab-${item.id}`} aria-selected={selected === index} aria-controls={`panel-${item.id}`} tabIndex={selected === index ? 0 : -1} ref={element => { tabs.current[index] = element }} onClick={() => choose(index)} onKeyDown={event => {
            let next = index
            if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % SCENARIOS.length
            else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (index + SCENARIOS.length - 1) % SCENARIOS.length
            else if (event.key === 'Home') next = 0
            else if (event.key === 'End') next = SCENARIOS.length - 1
            else return
            event.preventDefault(); choose(next); tabs.current[next]?.focus()
          }}><span className="scenario-icon"><Icon name={item.icon} size={23} /></span><span><strong>{item.title}</strong><small>{item.description}</small></span><span className="tab-arrow"><Icon name="arrow" size={17} /></span></button>)}
        </div>
        <p className="sidebar-note">A few possibilities.<br />A lot of people to think about.</p>
      </div>
      <div className="scenario-panel" role="tabpanel" id={`panel-${scenario.id}`} aria-labelledby={`tab-${scenario.id}`} tabIndex={0}>
        <div className="simulation-toolbar"><span className="scene-state"><i />{changed ? scenario.changed : scenario.original}</span><div><span className="demo-label">ILLUSTRATIVE DEMO</span><button className="icon-button" aria-label={playing ? 'Pause animation' : 'Play animation'} aria-pressed={!playing} onClick={() => setPlaying(!playing)} disabled={reduced}><Icon name={playing ? 'pause' : 'play'} size={17} /></button><button className="icon-button" aria-label="Reset scenario" onClick={() => { setChanged(false); setPlaying(true); setReset(value => value + 1) }}><Icon name="reset" size={17} /></button></div></div>
        <ScenarioCanvas scenario={scenario.id} changed={changed} playing={playing} reset={reset} reduced={reduced} />
        <div className="simulation-bottom"><span><span className="person-key" />100 illustrated people</span><span>{reduced ? 'Reduced motion enabled' : 'A little world, in motion'}</span></div>
      </div>
    </div>
    <div className="what-if-bar"><div><p>“{scenario.prompt}”</p></div><button className={changed ? 'button button-subtle' : 'button button-green'} onClick={() => setChanged(!changed)}>{changed ? 'Restore original' : 'Try this what-if'}<Icon name={changed ? 'reset' : 'arrow'} size={17} /></button></div>
    <p className="scenario-result" aria-live="polite">{changed ? scenario.result : 'These are scripted previews. In the full product, describe a change, review it, and apply it.'}</p>
  </section>
}
