import { useId, useState } from 'react'
import { CrowdSafetyScene, type SafetySceneType } from './CrowdSafetyScene'
import { project } from './safetyGeometry'
import { safetyAnnotations } from './safetyAnnotations'

const titles: Record<SafetySceneType, string> = {
  concert: 'Crowd density and barriers at a concert',
  alley: 'Pedestrian flows through a narrow alley',
  nightclub: 'Evacuation routes and a congested entrance',
  consequences: 'How congestion can affect evacuation and emergency access',
}

/** Markers are real HTML buttons over an SVG, so touch, focus and zoom share
 * the same interaction. Explanations remain readable outside the illustration. */
export function IncidentVisualization({ type, consequences = false }: { type: SafetySceneType; consequences?: boolean }) {
  const [active, setActive] = useState(0)
  const uid = useId().replace(/:/g, '')
  const annotations = safetyAnnotations[type]
  return <figure className={`incident-figure${consequences ? ' consequences-figure' : ''}`} aria-label={consequences ? 'Potential consequences of congestion' : 'Explore the spatial concerns'}>
    {!consequences && <div className="diagram-heading"><span>Crowd movement</span><span>Conceptual study</span></div>}
    {!consequences && <h4 className="diagram-title">{titles[type]}</h4>}
    <div className="scene-stage">
      <CrowdSafetyScene type={type} active={active} title={titles[type]} />
      <svg className="scene-leaders" viewBox="0 0 720 460" aria-hidden="true">{annotations.map((note, index) => {
        const target = project(note.target)
        return <g key={note.title} className={active === index ? 'is-active' : ''}><path d={`M${note.marker[0]} ${note.marker[1]}L${target.x} ${target.y}`} /><circle cx={target.x} cy={target.y} r="3" /></g>
      })}</svg>
      {annotations.map((note, index) => <button key={note.title} className={`scene-marker${active === index ? ' is-active' : ''}`} style={{ left: `${note.marker[0] / 7.2}%`, top: `${note.marker[1] / 4.6}%` }} type="button" aria-label={`${index + 1}. ${note.title}`} aria-pressed={active === index} aria-controls={`${uid}-note-${index}`} aria-describedby={`${uid}-note-${index}`} onClick={() => setActive(index)} onFocus={() => setActive(index)}>0{index + 1}</button>)}
    </div>
    <div className="scene-key" aria-hidden="true"><span><svg viewBox="0 0 24 12"><path d="M1 6h21m-7-4 7 4-7 4" /></svg>Illustrative movement</span><span><i />Area of concern</span></div>
    <div className={consequences ? 'consequence-notes' : 'spatial-notes'} aria-label="Diagram annotations">
      {!consequences && <p className="annotation-instruction">Select a numbered point for an explanation</p>}
      {annotations.map((note, index) => <div className={`spatial-note${active === index ? ' is-active' : ''}`} key={note.title}>
        <button type="button" aria-expanded={consequences ? undefined : active === index} aria-pressed={consequences ? active === index : undefined} aria-controls={`${uid}-note-${index}`} aria-describedby={`${uid}-note-${index}`} onClick={() => setActive(index)} onFocus={() => setActive(index)}><span>0{index + 1}</span><strong>{note.title}</strong><span className="note-indicator" aria-hidden="true">{active === index ? '−' : '+'}</span></button>
        <p id={`${uid}-note-${index}`} hidden={!consequences && active !== index}>{note.copy}</p>
      </div>)}
    </div>
    <figcaption>{consequences ? 'Conceptual illustration. These risks depend on the situation and may occur separately.' : 'Conceptual illustration, not the historical layout or a simulation result.'}</figcaption>
  </figure>
}
