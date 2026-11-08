import { Auth0Provider, useAuth0, type AppState } from '@auth0/auth0-react'
import { useEffect, useState, type ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'
import { BrandMark } from './site/Site.tsx'
import { currentPlace, navigate } from './site/navigate.ts'
import { explainSignInError } from './site/signInErrors.ts'
import { useAuthFetch } from './site/useAuthFetch.ts'
import { syncVenues } from './site/venueSync.ts'
import './auth.css'

const domain = import.meta.env.VITE_AUTH0_DOMAIN
const clientId = import.meta.env.VITE_AUTH0_CLIENT_ID
const audience = import.meta.env.VITE_AUTH0_AUDIENCE

/** The full-page frame of every sign-in state: brand at the top, one panel in the middle. */
function AuthFrame({ children, busy = false }: { children: ReactNode; busy?: boolean }) {
  return (
    <div className="auth-page">
      <p className="cc-brand auth-brand"><BrandMark /> Crowd Control</p>
      <main className="auth-panel" aria-busy={busy}>{children}</main>
      <p className="auth-foot">Planning estimates for crowds, not certified safety advice.</p>
    </div>
  )
}

function AuthScreen({ children }: { children: ReactNode }) {
  const { error, isAuthenticated, isLoading, loginWithRedirect } = useAuth0()
  const signIn = () => void loginWithRedirect({ appState: { returnTo: currentPlace() } })

  // A failed sign-in comes back with ?error=… in the address; keep the page, drop the noise.
  useEffect(() => {
    if (error && /[?&](error|code|state)=/.test(window.location.search)) window.history.replaceState(null, '', currentPlace())
  }, [error])

  if (isLoading) {
    return (
      <AuthFrame busy>
        <p className="auth-loading" role="status"><LoaderCircle className="auth-spin" size={18} aria-hidden="true" /> Checking your sign-in…</p>
      </AuthFrame>
    )
  }
  if (error) {
    const { title, detail } = explainSignInError(error.message, window.location.origin)
    return (
      <AuthFrame>
        <h1>{title}</h1>
        <p role="alert">{detail}</p>
        <button type="button" className="auth-button" onClick={signIn}>Try again</button>
      </AuthFrame>
    )
  }
  if (!isAuthenticated) {
    return (
      <AuthFrame>
        <h1>Sign in to Crowd Control</h1>
        <p>Watch how a crowd moves through a venue, change things while it runs, and keep every run to look back on.</p>
        <button type="button" className="auth-button" onClick={signIn}>Sign in</button>
      </AuthFrame>
    )
  }
  return <AccountSync>{children}</AccountSync>
}

/** How long a page waits for the account's floor plans before opening without them. */
const SYNC_WAIT_MS = 4000

/**
 * Brings the account's floor plans into this browser (and this browser's up to the account)
 * before any page opens, since pages read the saved plans when they start. A slow or failed
 * sync never blocks: after a few seconds the page opens with what this browser has.
 */
function AccountSync({ children }: { children: ReactNode }) {
  const authFetch = useAuthFetch()
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let done = false
    const finish = () => { if (!done) { done = true; setReady(true) } }
    const timer = window.setTimeout(finish, SYNC_WAIT_MS)
    void syncVenues(authFetch).then((result) => {
      if (result.error) console.warn(`[floor plans] Couldn’t sync with your account: ${result.error}`)
    }).finally(() => {
      window.clearTimeout(timer)
      finish()
    })
    return () => window.clearTimeout(timer)
  }, [authFetch])
  if (!ready) {
    return (
      <AuthFrame busy>
        <p className="auth-loading" role="status"><LoaderCircle className="auth-spin" size={18} aria-hidden="true" /> Loading your floor plans…</p>
      </AuthFrame>
    )
  }
  return <>{children}</>
}

export default function AuthGate({ children }: { children: ReactNode }) {
  if (!domain || !clientId || !audience) {
    const missing = [
      !domain && 'VITE_AUTH0_DOMAIN',
      !clientId && 'VITE_AUTH0_CLIENT_ID',
      !audience && 'VITE_AUTH0_AUDIENCE',
    ].filter((value): value is string => typeof value === 'string')
    return (
      <AuthFrame>
        <h1>Sign-in isn’t set up yet</h1>
        <p>Add these to the root <code>.env</code>, then restart the site:</p>
        <ul className="auth-missing">{missing.map((name) => <li key={name}><code>{name}</code></li>)}</ul>
      </AuthFrame>
    )
  }

  return (
    <Auth0Provider
      domain={domain.replace(/^https?:\/\//, '').replace(/\/+$/, '')}
      clientId={clientId}
      authorizationParams={{ redirect_uri: window.location.origin, audience }}
      // Stay signed in across reloads: browsers block Auth0's hidden-iframe check on localhost.
      cacheLocation="localstorage"
      useRefreshTokens
      useRefreshTokensFallback
      onRedirectCallback={(state?: AppState) => navigate(typeof state?.returnTo === 'string' ? state.returnTo : '/sim')}
    >
      <AuthScreen>{children}</AuthScreen>
    </Auth0Provider>
  )
}
