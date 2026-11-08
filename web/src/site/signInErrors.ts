/**
 * Auth0's sign-in errors in words a person can act on. The common ones are setup mismatches
 * between this site's .env and the Auth0 dashboard, so each says what to change.
 */
export function explainSignInError(message: string, origin: string): { title: string; detail: string } {
  const service = /Service not found:\s*(\S+)/i.exec(message)
  if (service) {
    return {
      title: 'The sign-in settings don’t match',
      detail: `Auth0 has no API called ${service[1]}. In the root .env, AUTH0_AUDIENCE and VITE_AUTH0_AUDIENCE must both be that API’s exact Identifier from the Auth0 dashboard (a trailing slash counts). Then restart the site and the server.`,
    }
  }
  if (/callback url mismatch|redirect_uri/i.test(message)) {
    return {
      title: 'This address isn’t allowed to sign in yet',
      detail: `Add ${origin} to the Auth0 application’s Allowed Callback URLs, Allowed Logout URLs and Allowed Web Origins, then try again.`,
    }
  }
  if (/invalid state/i.test(message)) {
    return { title: 'That sign-in expired', detail: 'It was started a while ago or in another tab. Try again.' }
  }
  if (/login required|consent required|missing refresh token/i.test(message)) {
    return { title: 'Please sign in again', detail: 'Your session ended.' }
  }
  return { title: 'Sign-in didn’t work', detail: `Auth0 said: ${message}` }
}
