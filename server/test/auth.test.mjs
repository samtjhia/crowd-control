import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
} from 'jose'
import {
  createAuth0TokenVerifier,
  createBearerTokenVerifier,
} from '../dist/auth.js'

const issuer = 'https://crowd-control.example.auth0.com/'
const audience = 'https://api.crowd-control.example'

test('verifies Auth0-style RS256 access tokens and returns the signed subject', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  const publicJwk = await exportJWK(publicKey)
  const getKey = createLocalJWKSet({
    keys: [{ ...publicJwk, kid: 'test-key', use: 'sig', alg: 'RS256' }],
  })
  const verify = createBearerTokenVerifier(issuer, audience, getKey)
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject('auth0|organizer-1')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey)

  assert.equal(await verify(`Bearer ${token}`), 'auth0|organizer-1')
  assert.equal(await verify(undefined), null)
  assert.equal(await verify('Basic abc'), null)
})

test('rejects access tokens with the wrong audience or issuer', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  const getKey = createLocalJWKSet({
    keys: [{ ...await exportJWK(publicKey), kid: 'test-key', use: 'sig', alg: 'RS256' }],
  })
  const verify = createBearerTokenVerifier(issuer, audience, getKey)
  const makeToken = (tokenIssuer, tokenAudience) => new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(tokenIssuer)
    .setAudience(tokenAudience)
    .setSubject('auth0|organizer-1')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey)

  assert.equal(await verify(`Bearer ${await makeToken(issuer, 'another-api')}`), null)
  assert.equal(await verify(`Bearer ${await makeToken('https://another-tenant/', audience)}`), null)
})

test('requires both Auth0 server settings and rejects insecure domains', () => {
  assert.equal(createAuth0TokenVerifier(undefined, audience), null)
  assert.equal(createAuth0TokenVerifier('crowd-control.example.auth0.com', undefined), null)
  assert.throws(
    () => createAuth0TokenVerifier('http://crowd-control.example.auth0.com', audience),
    /HTTPS Auth0 domain/,
  )
})
