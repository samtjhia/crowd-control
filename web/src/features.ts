// Vite provides the build default; the API's runtime setting is authoritative at startup.
export let GEMINI_ENABLED = import.meta.env ? import.meta.env.GEMINI_ENABLED === true : true

export async function loadFeatures(fetcher: typeof fetch = fetch): Promise<void> {
  try {
    const response = await fetcher('/api/features', { cache: 'no-store', signal: AbortSignal.timeout(3000) })
    const features: unknown = await response.json()
    GEMINI_ENABLED = response.ok && typeof features === 'object' && features !== null
      && 'geminiEnabled' in features && features.geminiEnabled === true
  } catch {
    GEMINI_ENABLED = false
  }
}
