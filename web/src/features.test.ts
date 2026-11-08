import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createServer } from 'vite'

test('dev-served Gemini flag honors PROD without relying on browser globals', async () => {
  const previous = process.env.PROD
  try {
    for (const [value, expected] of [['TRUE', false], ['FALSE', true]] as const) {
      process.env.PROD = value
      const server = await createServer({
        root: fileURLToPath(new URL('../', import.meta.url)),
        configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
        logLevel: 'silent',
        server: { middlewareMode: true, ws: false, hmr: false, watch: null },
      })
      try {
        const transformed = await server.transformRequest('/src/features.ts')
        assert.ok(transformed)
        const module = await import(`data:text/javascript;base64,${Buffer.from(transformed.code).toString('base64')}`)
        assert.equal(module.GEMINI_ENABLED, expected, `PROD=${value} must control the actual dev module`)
        for (const enabled of [false, true]) {
          await module.loadFeatures(async (url: string, init: RequestInit) => {
            assert.equal(url, '/api/features')
            assert.equal(init.cache, 'no-store')
            return new Response(JSON.stringify({ geminiEnabled: enabled }))
          })
          assert.equal(module.GEMINI_ENABLED, enabled, 'API runtime overrides a different build setting')
        }
        await module.loadFeatures(async () => new Response(JSON.stringify({ geminiEnabled: true }), { status: 503 }))
        assert.equal(module.GEMINI_ENABLED, false, 'unsuccessful settings responses cannot enable AI')
        await module.loadFeatures(async () => new Response(JSON.stringify({ geminiEnabled: 'true' })))
        assert.equal(module.GEMINI_ENABLED, false, 'malformed settings cannot enable AI')
        await module.loadFeatures(async () => { throw new Error('offline') })
        assert.equal(module.GEMINI_ENABLED, false, 'AI stays hidden if runtime settings cannot load')
      } finally { await server.close() }
    }
  } finally {
    if (previous === undefined) delete process.env.PROD
    else process.env.PROD = previous
  }
})
