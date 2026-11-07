import assert from 'node:assert/strict'
import test from 'node:test'
import { explainSignInError } from './signInErrors.ts'
import { currentPlace } from './navigate.ts'

test('sign-in setup errors say what to change', () => {
  const service = explainSignInError('Service not found: https://crowd-control-api/', 'http://localhost:5173')
  assert.equal(service.title, 'The sign-in settings don’t match')
  assert.match(service.detail, /no API called https:\/\/crowd-control-api\/.*AUTH0_AUDIENCE and VITE_AUTH0_AUDIENCE/)
  assert.match(explainSignInError('Callback URL mismatch.', 'http://localhost:5173').detail, /Add http:\/\/localhost:5173 to the Auth0 application’s Allowed Callback URLs/)
  assert.equal(explainSignInError('Invalid state', 'x').title, 'That sign-in expired')
  assert.deepEqual(explainSignInError('Something odd', 'x'), { title: 'Sign-in didn’t work', detail: 'Auth0 said: Something odd' })
})

test('after signing in you come back to the page you asked for, without sign-in noise', () => {
  const location = (href: string) => {
    const url = new URL(href)
    Object.defineProperty(globalThis, 'window', { value: { location: { pathname: url.pathname, search: url.search, hash: url.hash } }, configurable: true })
  }
  location('http://localhost:5173/history?code=abc&state=xyz')
  assert.equal(currentPlace(), '/history')
  location('http://localhost:5173/sim?scenario=concert-floor&error=access_denied&error_description=x')
  assert.equal(currentPlace(), '/sim?scenario=concert-floor')
  location('http://localhost:5173/')
  assert.equal(currentPlace(), '/sim', 'the home page is the simulator')
})
