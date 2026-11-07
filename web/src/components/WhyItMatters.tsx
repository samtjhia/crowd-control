import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Icon } from './Icons'
import { IncidentVisualization } from './IncidentVisualization'
import { incidents } from './incidents'

const consequences = [
  { title: 'Longer evacuations', copy: 'Bottlenecks can increase the time needed for people to reach safety.', path: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 3v5l3 2' },
  { title: 'Dangerous crowd pressure', copy: 'Extreme crowd density can restrict movement and create potentially life-threatening pressure.', path: 'M8 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm8 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM5 20v-6a3 3 0 0 1 6 0v6m2 0v-6a3 3 0 0 1 6 0v6M2 12l2 2-2 2m20-4-2 2 2 2' },
  { title: 'Delayed emergency access', copy: 'Congestion and blocked routes can make it harder for first responders to reach people in need.', path: 'M4 20v-7a5 5 0 0 1 5-5h10m-4-4 4 4-4 4M5 4v4m-2-2h4m7 10 5 5m0-5-5 5' },
  { title: 'Greater risk of harm', copy: 'During fast-developing emergencies, delays in reaching safety can increase exposure to dangerous conditions.', path: 'm12 3 10 18H2L12 3Zm0 6v5m0 3v.5' },
]

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
    {incidents.map((incident, index) => <button key={incident.id} ref={element => { tabs.current[index] = element }} id={`incident-tab-${incident.id}`} type="button" role="tab" aria-controls="incident-panel" aria-selected={selected === index} tabIndex={selected === index ? 0 : -1} onClick={() => onSelect(index)} onKeyDown={event => onKeyDown(event, index)}><span aria-hidden="true">0{index + 1}</span>{incident.tab}</button>)}
  </div>
}

export function WhyItMatters({ reduced }: { reduced: boolean }) {
  const [selected, setSelected] = useState(0)
  const [displayed, setDisplayed] = useState(0)
  useEffect(() => {
    if (selected === displayed) return
    const timer = window.setTimeout(() => setDisplayed(selected), reduced ? 0 : 150)
    return () => window.clearTimeout(timer)
  }, [selected, displayed, reduced])
  const incident = incidents[displayed]
  const leaving = selected !== displayed
  return <section className="why-matters" id="why-it-matters" aria-labelledby="why-title">
    <div className="why-intro">
      <span className="why-eyebrow">04 / WHY IT MATTERS</span>
      <h2 id="why-title">Behind every crowd,<br /><span>there are people.</span></h2>
      <p>A crowded concert. A narrow street. A stadium exit. When crowd movement becomes unsafe, the consequences can be devastating. These real stories show why understanding crowd behaviour and preparing ahead matters.</p>
    </div>
    <div className="why-explorer">
      <IncidentTabs selected={selected} onSelect={setSelected} />
      <div id="incident-panel" role="tabpanel" tabIndex={0} aria-labelledby={`incident-tab-${incident.id}`} aria-busy={leaving} className={`incident-panel${leaving ? ' is-leaving' : ''}`}>
        <div className="incident-content" key={incident.id}>
          <article className="incident-story" aria-labelledby={`incident-title-${incident.id}`}>
            <p className="incident-location">{incident.location}<span>{incident.date}</span></p>
            <h3 id={`incident-title-${incident.id}`}>{incident.title}</h3>
            <p className="incident-fatalities"><strong>{incident.fatalities}</strong><span>lives lost</span></p>
            <p className="incident-account">{incident.description}</p>
            {incident.findings && <div className="incident-findings"><h4>NIST findings</h4><ul>{incident.findings.map(finding => <li key={finding}>{finding}</li>)}</ul></div>}
            <div className="incident-concern"><h4>The safety concern</h4><p>{incident.safetyConcern}</p></div>
            <div className="incident-question"><h4>The planning question</h4><p>{incident.planningQuestion}</p></div>
            <a className="incident-source" href={incident.sourceUrl} target="_blank" rel="noreferrer">Read the source <Icon name="diagonal" size={16} /><span>{incident.sourceName}</span><span className="sr-only"> (opens in a new tab)</span></a>
          </article>
          <IncidentVisualization type={incident.visualizationType} />
        </div>
      </div>
      <p className="incident-context">Diagrams explain general planning concerns. They do not show historical layouts or simulation results.</p>
    </div>
    <section className="why-consequences" aria-labelledby="consequences-title">
      <div className="why-impact-intro"><span className="why-eyebrow">THE CONSEQUENCES</span><h2 id="consequences-title">When movement stops,<br /><span>the risks don’t.</span></h2><p>Congestion can do more than slow people down. In an emergency, restricted movement can affect evacuation, access to assistance, and exposure to dangerous conditions.</p></div>
      <div className="consequence-grid">{consequences.map((item, index) => <article className="consequence-item" key={item.title}><div className="consequence-top"><span>0{index + 1}</span><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={item.path} /></svg></div><h3>{item.title}</h3><p>{item.copy}</p></article>)}</div>
    </section>
    <div className="why-closing"><span className="why-eyebrow">WHY WE BUILT CROWD CONTROL</span><h2>Better preparation starts<br /><span>before the crowd arrives.</span></h2><p>Explore potential risks, test alternative scenarios, and make more informed decisions before an event takes place.</p><a className="button button-green" href="#scenarios">Explore Crowd Control <Icon name="arrow" size={18} /></a><p className="why-planning-note">Simulations help explore possible outcomes. They are not validated predictions or guarantees of safety.</p></div>
  </section>
}
