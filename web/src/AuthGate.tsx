import { Auth0Provider, useAuth0 } from '@auth0/auth0-react'
import type { ReactNode } from 'react'

const domain = import.meta.env.VITE_AUTH0_DOMAIN
const clientId = import.meta.env.VITE_AUTH0_CLIENT_ID
const audience = import.meta.env.VITE_AUTH0_AUDIENCE

function AuthScreen({ children }: { children?: ReactNode }) {
  const { error, isAuthenticated, isLoading, loginWithRedirect, logout, user } = useAuth0()

  if (isLoading) return <main className="auth-screen" aria-live="polite">Checking sign-in…</main>
  if (error) {
    return (
      <main className="auth-screen">
        <h1>Sign-in failed</h1>
        <p role="alert">{error.message}</p>
        <button type="button" onClick={() => void loginWithRedirect()}>Try again</button>
      </main>
    )
  }
  if (!isAuthenticated) {
    return (
      <main className="auth-screen">
        <p className="eyebrow">Crowd Control</p>
        <h1>Sign in to continue</h1>
        <p>Sign-in is required to use the planner, simulator, and saved run data.</p>
        <button type="button" onClick={() => void loginWithRedirect()}>Sign in</button>
      </main>
    )
  }

  return (
    <>
      <header className="auth-header">
        <nav aria-label="Main navigation">
          <a href="/planner">Create simulation</a>
          <a href="/history">Past simulations</a>
        </nav>
        <div className="auth-account">
          <span>{user?.name ?? user?.email ?? 'Signed in'}</span>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void logout({ logoutParams: { returnTo: window.location.origin } })}
          >
            Sign out
          </button>
        </div>
      </header>
      {children}
    </>
  )
}

export default function AuthGate({ children }: { children: ReactNode }) {
  if (!domain || !clientId || !audience) {
    const missing = [
      !domain && 'VITE_AUTH0_DOMAIN',
      !clientId && 'VITE_AUTH0_CLIENT_ID',
      !audience && 'VITE_AUTH0_AUDIENCE',
    ].filter((value): value is string => typeof value === 'string')
    return (
      <main className="auth-screen">
        <h1>Authentication setup required</h1>
        <p>Set these values in the root <code>.env</code>, then restart the frontend:</p>
        <ul>{missing.map((name) => <li key={name}>{name}</li>)}</ul>
      </main>
    )
  }

  return (
    <Auth0Provider
      domain={domain.replace(/^https?:\/\//, '').replace(/\/+$/, '')}
      clientId={clientId}
      authorizationParams={{
        redirect_uri: window.location.origin,
        audience,
      }}
    >
      <AuthScreen>{children}</AuthScreen>
    </Auth0Provider>
  )
}
