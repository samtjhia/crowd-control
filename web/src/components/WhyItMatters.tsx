import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Icon } from './Icons'
import { IncidentVisualization } from './IncidentVisualization'
import { incidents } from './incidents'
import './whyItMatters.css'

function IncidentTabs({ selected, onSelect }: { selected: number; onSelect: (index: number) => void }) {
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number
    if (event.key === 'ArrowRight') next = (index + 1) % incidents.length
    else if (event.key === 'ArrowLeft') next = (index + incidents.length - 1) % incidents.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = incidents.length - 1
    else return
    event.preventDefault()
    onSelect(next)
    tabs.current[next]?.focus({ preventScroll: true })
    tabs.current[next]?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
  }
  return <div className="incident-tabs" role="tablist" aria-label="Historical crowd safety incidents">
    {incidents.map((incident, index) => <button key={incident.id} ref={element => { tabs.current[index] = element }} id={`incident-tab-${incident.id}`} type="button" role="tab" aria-controls="incident-panel" aria-selected={selected === index} tabIndex={selected === index ? 0 : -1} onClick={() => onSelect(index)} onKeyDown={event => onKeyDown(event, index)}>
      <span className="case-number" aria-hidden="true">0{index + 1}</span><span className="case-index-copy"><strong>{incident.tab}</strong><span>{incident.location.split(',')[0]}<span aria-hidden="true"> · </span>{incident.date.slice(-4)}</span></span><Icon name="diagonal" size={16} />
    </button>)}
  </div>
}

export function WhyItMatters({ reduced }: { reduced: boolean }) {
  const [selected, setSelected] = useState(0)
  const [displayed, setDisplayed] = useState(0)
  useEffect(() => {
    if (selected === displayed) return
    const timer = window.setTimeout(() => setDisplayed(selected), reduced ? 0 : 180)
    return () => window.clearTimeout(timer)
  }, [selected, displayed, reduced])
  const incident = incidents[reduced ? selected : displayed]
  const leaving = !reduced && selected !== displayed
  return <section className="why-matters" id="why-it-matters" aria-labelledby="why-title">
    <div className="investigation-masthead"><span>04 / Why it matters</span><span>Crowd movement and safety</span></div>
    <div className="why-intro">
      <h2 id="why-title">Crowd safety:<br /><span>real-world examples.</span></h2>
      <p>High crowd density and limited routes can restrict movement. These incidents show how congestion, evacuation problems, and failures in planning can have serious consequences.</p>
    </div>
    <div className="why-explorer">
      <div className="case-index-heading"><h3>Three case studies</h3><span>Select an incident <Icon name="down" size={15} /></span></div>
      <IncidentTabs selected={selected} onSelect={setSelected} />
      <div id="incident-panel" role="tabpanel" tabIndex={0} aria-labelledby={`incident-tab-${incident.id}`} aria-busy={leaving} className={`incident-panel${leaving ? ' is-leaving' : ''}`}>
        <div className="incident-content" key={incident.id}>
          <article className="incident-story" aria-labelledby={`incident-title-${incident.id}`}>
            <p className="incident-location">{incident.location}<span>{incident.date}</span></p>
            <h3 id={`incident-title-${incident.id}`}>{incident.title}</h3>
            <p className="incident-fatalities"><strong>{incident.fatalities}</strong><span>lives lost</span></p>
            <p className="incident-account">{incident.description}</p>
            <div className="incident-concern"><h4>The safety concern</h4><p>{incident.safetyConcern}</p></div>
            {incident.findings && <details className="incident-findings"><summary>Read the NIST findings <Icon name="down" size={14} /></summary><ul>{incident.findings.map(finding => <li key={finding}>{finding}</li>)}</ul></details>}
            <a className="incident-source" href={incident.sourceUrl} target="_blank" rel="noreferrer"><span>Read the source <Icon name="diagonal" size={15} /></span><small>{incident.sourceName}</small><span className="sr-only"> (opens in a new tab)</span></a>
          </article>
          <IncidentVisualization type={incident.visualizationType} />
          <div className="incident-question"><span>Planning question</span><p>{incident.planningQuestion}</p><Icon name="arrow" size={27} /></div>
        </div>
      </div>
    </div>
    <section className="why-consequences" aria-labelledby="consequences-title">
      <div className="why-impact-intro"><h2 id="consequences-title">The risks of poor<br /><span>crowd management.</span></h2><p>Congestion can slow evacuation and make it harder for emergency services to reach people. Depending on the situation, it can also increase crowd pressure or exposure to hazards.</p></div>
      <IncidentVisualization type="consequences" consequences />
    </section>
    <div className="why-closing">
      <div className="preparation-path" aria-hidden="true"><svg viewBox="0 0 180 130"><path d="M-10 102H55Q80 102 80 78V48Q80 25 104 25H185" fill="none" stroke="#d9e2cc" strokeWidth="27" /><path d="M-10 102H55Q80 102 80 78V48Q80 25 104 25H185" fill="none" stroke="#f8f0df" strokeWidth="21" /><g fill="#57785e"><circle cx="36" cy="99" r="3" /><path d="M36 105v8" stroke="#57785e" strokeWidth="5" strokeLinecap="round" /><circle cx="82" cy="56" r="3" /><path d="M82 62v8" stroke="#839574" strokeWidth="5" strokeLinecap="round" /><circle cx="128" cy="22" r="3" /><path d="M128 28v8" stroke="#57785e" strokeWidth="5" strokeLinecap="round" /></g></svg></div>
      <div><h2>Test crowd scenarios<br /><span>before an event.</span></h2><p>Explore crowd movement, change a scenario, and see how routes and congestion respond.</p><a className="text-link impact-cta" href="#scenarios">Explore Crowd Control <Icon name="arrow" size={22} /></a></div>
      <p className="why-planning-note">Simulations explore possible outcomes. They do not provide validated predictions or guarantee safety.</p>
    </div>
  </section>
}
