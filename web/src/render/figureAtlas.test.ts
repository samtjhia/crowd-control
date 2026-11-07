import assert from 'node:assert/strict'
import test from 'node:test'
import type { Renderer, Texture } from 'pixi.js'
import { FigureAtlas } from './figureAtlas.ts'

test('texture collection stays bounded across animation/zoom churn and preserves visible sprites', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { devicePixelRatio: 1 } })
  let created = 0, destroyed = 0, pixelSize = 64, liveBytes = 0
  const freed = new Set<Texture>()
  const renderer = { generateTexture() {
    created++
    const bytes = pixelSize * pixelSize * 4
    liveBytes += bytes
    const texture = { source: { pixelWidth: pixelSize, pixelHeight: pixelSize }, destroy() { assert.ok(!freed.has(texture)); freed.add(texture); destroyed++; liveBytes -= bytes } } as unknown as Texture
    return texture
  } } as unknown as Renderer
  const atlas = new FigureAtlas(renderer)
  const get = (n: number) => atlas.get(`#${n.toString(16).padStart(6, '0')}`, '#D9A987', '#40322A', { hair: 'short', outfit: 'trousers' }, 'stand', 24).texture
  try {
    const visible = new Set([get(0), get(1), get(2)])
    for (let frame = 0; frame < 8; frame++) {
      for (let i = 0; i < 1000; i++) get(3 + frame * 1000 + i)
      atlas.retain(visible)
      assert.ok(created - destroyed <= 6000)
      for (const texture of visible) assert.ok(!freed.has(texture))
      const before = created
      assert.ok(visible.has(get(0)))
      assert.equal(created, before, 'visible figures are reused, not regenerated after eviction')
    }
    assert.ok(destroyed > 0)
    pixelSize = 1024
    for (let i = 0; i < 100; i++) get(30000 + i)
    atlas.retain(visible)
    assert.ok(liveBytes <= 128 * 1024 * 1024, 'unused zoom textures obey the byte budget too')
    for (const texture of visible) assert.ok(!freed.has(texture))
    atlas.clear()
    assert.equal(destroyed, created)
  } finally {
    atlas.clear()
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})
