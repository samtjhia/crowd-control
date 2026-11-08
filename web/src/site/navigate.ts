/**
 * Changes the page without a reload (the signed-in session lives in this page), and tells the
 * router in Root.tsx. Used after sign-in to return to the page that was asked for.
 */
export function navigate(to: string) {
  window.history.replaceState(null, '', to)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

/** Where to come back to after signing in: the page asked for, or Past runs (the home page). */
export function currentPlace(): string {
  const { pathname, search, hash } = window.location
  // Sign-in's own return parameters are never part of the place to come back to.
  const params = new URLSearchParams(search)
  for (const key of ['code', 'state', 'error', 'error_description', 'iss']) params.delete(key)
  const query = params.toString()
  const path = pathname === '/' ? '/history' : pathname
  return `${path}${query ? `?${query}` : ''}${hash}`
}
