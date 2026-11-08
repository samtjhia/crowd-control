import { useEffect, useRef, useState } from 'react'
import { Play, Trash2, Upload } from 'lucide-react'
import type { PreparedMap } from '@crowd-control/contract'
import { SiteHeader } from './site/Site.tsx'
import { useAuthFetch } from './site/useAuthFetch.ts'
import { deleteAccountVenue } from './site/venueSync.ts'
import { loadSavedVenues, removeSavedVenue, savedScenarioId, type SavedVenue } from './sim/savedVenues.ts'
import './history.css'
import './plans.css'

/**
 * Floor plans: the plans saved to the person's account (synced into this browser when they
 * signed in), each with a small drawing of it, a way to run it, and a way to delete it. Upload
 * opens the editor to trace a new one.
 */

/** "Today", "Yesterday" or "Nov 5". */
function savedOn(iso: string, now = new Date()): string {
  const date = new Date(iso)
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((day(now) - day(date)) / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(date.getFullYear() !== now.getFullYear() && { year: 'numeric' }) })
}

/** A small drawing of a plan: walls dark, rooms in their colours, doors green. */
function PlanThumb({ map }: { map: PreparedMap }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const element = canvas.current
    const context = element?.getContext('2d')
    if (!element || !context) return
    const { grid } = map
    const scale = Math.min(element.width / grid.width, element.height / grid.height)
    const left = (element.width - grid.width * scale) / 2, top = (element.height - grid.height * scale) / 2
    const fills = new Map(map.entities.map((e) => [e.id, e.appearance?.fill]))
    context.clearRect(0, 0, element.width, element.height)
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const i = y * grid.width + x
        const portal = grid.portalIds[grid.portalIndex[i]!]
        const zone = grid.zoneIds[grid.zoneIndex[i]!]
        context.fillStyle = grid.blocked[i] === 1 ? '#7f9479' : portal ? '#9fcf96' : (zone && fills.get(zone)) || '#fafbf6'
        context.fillRect(left + x * scale, top + y * scale, Math.ceil(scale), Math.ceil(scale))
      }
    }
  }, [map])
  return <canvas ref={canvas} className="plan-thumb" width={320} height={180} aria-hidden="true" />
}

export default function PlansApp() {
  const authFetch = useAuthFetch()
  const [venues, setVenues] = useState<SavedVenue[]>(() => loadSavedVenues())
  const [confirming, setConfirming] = useState<string | null>(null)
  const [problem, setProblem] = useState<{ id: string; message: string } | null>(null)

  const remove = async (venue: SavedVenue) => {
    const error = await deleteAccountVenue(authFetch, venue.map.id)
    if (error) { setProblem({ id: venue.map.id, message: error }); return }
    removeSavedVenue(venue.map.id)
    setVenues(loadSavedVenues())
    setConfirming(null)
  }

  return (
    <div className="hist-page">
      <SiteHeader />
      <main className="hist">
        <div className="hist-head">
          <div>
            <h1>Floor plans</h1>
            <p>Venues you’ve traced and saved to your account. Run crowds on one, or upload a new plan to trace its walls, rooms and doors.</p>
          </div>
          <a className="hist-button plans-upload" href="/editor"><Upload size={15} aria-hidden="true" /> Upload a floor plan</a>
        </div>

        {venues.length === 0 ? (
          <div className="hist-list hist-empty plans-empty">
            <h2>No floor plans yet</h2>
            <p>Upload a drawing or screenshot of your venue. You’ll set its scale, trace walls, name the rooms and mark the doors, then save it here.</p>
            <a className="hist-button" href="/editor"><Upload size={15} aria-hidden="true" /> Upload a floor plan</a>
          </div>
        ) : (
          <ul className="plans-grid">
            {venues.map((venue) => {
              const rooms = venue.map.entities.filter((e) => e.kind === 'zone').length
              const doors = venue.map.entities.filter((e) => e.kind === 'portal').length
              return (
                <li key={venue.map.id} className="plans-card">
                  <PlanThumb map={venue.map} />
                  <div className="plans-card-body">
                    <h2>{venue.name}</h2>
                    <p>{venue.floor} · {rooms} {rooms === 1 ? 'room' : 'rooms'}, {doors} {doors === 1 ? 'door' : 'doors'} · saved {savedOn(venue.savedAt)}</p>
                    {venue.map.grid.units !== 'm' && <p className="plans-note">No scale set, so crowding is relative rather than people per m².</p>}
                    <div className="plans-actions">
                      <a className="hist-button" href={`/sim?scenario=${encodeURIComponent(savedScenarioId(venue))}`}><Play size={14} aria-hidden="true" /> Open in simulator</a>
                      {confirming === venue.map.id ? (
                        <span className="hist-confirm" role="group" aria-label="Confirm delete">
                          <span>Delete this floor plan?</span>
                          <button type="button" className="hist-danger" onClick={() => void remove(venue)}>Delete</button>
                          <button type="button" className="hist-link" onClick={() => setConfirming(null)}>Cancel</button>
                        </span>
                      ) : (
                        <button type="button" className="hist-quiet" onClick={() => setConfirming(venue.map.id)}><Trash2 size={14} aria-hidden="true" /> Delete</button>
                      )}
                    </div>
                    {problem?.id === venue.map.id && <p className="hist-problem" role="alert">Couldn’t delete it: {problem.message}</p>}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </main>
    </div>
  )
}
