import { useCallback } from 'react'
import { useAuth0 } from '@auth0/auth0-react'

/** `fetch` with the signed-in person's Auth0 access token, which every server /api route requires. */
export function useAuthFetch() {
  const { getAccessTokenSilently } = useAuth0()
  return useCallback(async (input: string, init: RequestInit = {}) => {
    const token = await getAccessTokenSilently()
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    return fetch(input, { ...init, headers })
  }, [getAccessTokenSilently])
}
