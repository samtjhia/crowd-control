import { loadSavedVenues, replaceSavedVenues, type SavedVenue } from '../sim/savedVenues.ts'

/**
 * Keeps floor plans in the signed-in account (the server's /api/venues) and this browser's copy
 * in step. Pages read the browser copy, so it stays the working set; the account is where plans
 * live between browsers and devices. For each plan the newer save wins, by its savedAt.
 */

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>

async function reason(response: Response): Promise<string> {
  const payload: unknown = await response.json().catch(() => null)
  return typeof payload === 'object' && payload !== null && 'error' in payload && typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`
}

/** Saves one floor plan to the account. Returns why not, or null when it saved. */
export async function pushVenue(fetcher: Fetcher, venue: SavedVenue): Promise<string | null> {
  try {
    const response = await fetcher(`/api/venues/${encodeURIComponent(venue.map.id)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(venue),
    })
    return response.ok ? null : await reason(response)
  } catch {
    return 'the server can’t be reached'
  }
}

/** Removes one floor plan from the account. Returns why not, or null when it's gone. */
export async function deleteAccountVenue(fetcher: Fetcher, id: string): Promise<string | null> {
  try {
    const response = await fetcher(`/api/venues/${encodeURIComponent(id)}`, { method: 'DELETE' })
    return response.ok || response.status === 404 ? null : await reason(response)
  } catch {
    return 'the server can’t be reached'
  }
}

/** The newer of two copies of the same plan. */
const newer = (a: SavedVenue, b: SavedVenue) => (Date.parse(a.savedAt) >= Date.parse(b.savedAt) ? a : b)

/**
 * Merges the account's plans with this browser's: plans only in the account come down, plans
 * only here (saved before sign-in existed, or while offline) go up, and where both have one the
 * newer copy wins on both sides. Failures leave the browser copy as it was.
 */
export async function syncVenues(fetcher: Fetcher): Promise<{ downloaded: number; uploaded: number; error: string | null }> {
  let account: SavedVenue[]
  try {
    const response = await fetcher('/api/venues')
    if (!response.ok) return { downloaded: 0, uploaded: 0, error: await reason(response) }
    const payload = await response.json() as { venues?: SavedVenue[] }
    account = Array.isArray(payload.venues) ? payload.venues : []
  } catch {
    return { downloaded: 0, uploaded: 0, error: 'the server can’t be reached' }
  }
  const local = loadSavedVenues()
  const byId = new Map<string, SavedVenue>()
  for (const venue of [...local, ...account]) {
    const seen = byId.get(venue.map.id)
    byId.set(venue.map.id, seen ? newer(seen, venue) : venue)
  }
  const merged = [...byId.values()].sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt))
  const accountCopy = new Map(account.map((venue) => [venue.map.id, venue.savedAt]))
  const localCopy = new Map(local.map((venue) => [venue.map.id, venue.savedAt]))
  const toUpload = merged.filter((venue) => accountCopy.get(venue.map.id) !== venue.savedAt)
  const downloaded = merged.filter((venue) => localCopy.get(venue.map.id) !== venue.savedAt).length
  if (downloaded > 0) replaceSavedVenues(merged)
  let error: string | null = null
  let uploaded = 0
  for (const venue of toUpload) {
    const failed = await pushVenue(fetcher, venue)
    if (failed) error = failed
    else uploaded++
  }
  return { downloaded, uploaded, error }
}
