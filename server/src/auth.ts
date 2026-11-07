import {
  createRemoteJWKSet,
  errors,
  jwtVerify,
  type JWTVerifyGetKey,
} from 'jose'

export type AccessTokenVerifier = (authorization: string | undefined) => Promise<string | null>

export function createBearerTokenVerifier(
  issuer: string,
  audience: string,
  getKey: JWTVerifyGetKey,
): AccessTokenVerifier {
  return async (authorization) => {
    const match = /^Bearer ([^\s]+)$/i.exec(authorization ?? '')
    if (!match) return null

    try {
      const { payload } = await jwtVerify(match[1]!, getKey, {
        issuer,
        audience,
        algorithms: ['RS256'],
      })
      return typeof payload.sub === 'string' && payload.sub.length > 0 ? payload.sub : null
    } catch (error) {
      if (error instanceof errors.JOSEError) return null
      throw error
    }
  }
}

export function createAuth0TokenVerifier(
  domain: string | undefined,
  audience: string | undefined,
): AccessTokenVerifier | null {
  if (!domain || !audience) return null

  const domainUrl = new URL(domain.includes('://') ? domain : `https://${domain}`)
  if (domainUrl.protocol !== 'https:' || domainUrl.pathname !== '/' || domainUrl.search || domainUrl.hash) {
    throw new Error('AUTH0_DOMAIN must be an HTTPS Auth0 domain without a path.')
  }

  const issuer = `${domainUrl.origin}/`
  const getKey = createRemoteJWKSet(new URL('.well-known/jwks.json', issuer))
  return createBearerTokenVerifier(issuer, audience, getKey)
}
