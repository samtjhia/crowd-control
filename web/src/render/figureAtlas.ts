import { Container, Graphics, type Renderer, type Texture } from 'pixi.js'

export type FigurePose = 'stand' | 'stepA' | 'stepB' | 'fallen'

/** How a person is drawn beyond colour, so a crowd reads as mixed. Presentation only: never size or speed. */
export type FigureLook = { hair: 'short' | 'long' | 'bun' | 'ponytail'; outfit: 'trousers' | 'skirt' }

export type FigureTexture = {
  texture: Texture
  /** Sprite anchor that puts the person's torso on their simulated position. */
  anchorX: number
  anchorY: number
  /** Rendered height in CSS pixels, for placing badges above the head. */
  height: number
}

/** Colours × skin × hair × look × pose can reach ~800 figures per size; each is a few KB. */
const MAX_TEXTURES = 2000
/** Figure heights snap to ~12% steps so zooming reuses textures instead of minting new ones. */
const SIZE_STEP = 1.12

function bucket(heightPx: number): number {
  const steps = Math.round(Math.log(Math.max(8, heightPx) / 8) / Math.log(SIZE_STEP))
  return Math.round(8 * Math.pow(SIZE_STEP, steps))
}

/**
 * Pre-drawn person figures in the landing page's style (pill torso, round head, legs),
 * generated once per colour, skin, hair, pose and size and shared by every sprite, so
 * thousands of people cost one texture lookup each per frame.
 */
export class FigureAtlas {
  private readonly renderer: Renderer
  private readonly cache = new Map<string, FigureTexture>()
  /** Textures from before the last eviction; destroyed only once no sprite can still show them. */
  private retired: FigureTexture[] = []
  /** Bumps whenever the cache is emptied, so the renderer knows to re-point every sprite. */
  generation = 0

  constructor(renderer: Renderer) {
    this.renderer = renderer
  }

  get(body: string, skin: string, hair: string, look: FigureLook, pose: FigurePose, heightPx: number): FigureTexture {
    const size = bucket(heightPx)
    const key = `${body}|${skin}|${hair}|${look.hair}|${look.outfit}|${pose}|${size}`
    const hit = this.cache.get(key)
    if (hit) return hit
    if (this.cache.size >= MAX_TEXTURES) {
      // Never destroy a texture a sprite may still be drawing: retire it until every sprite moves on.
      this.retired.push(...this.cache.values())
      this.cache.clear()
      this.generation++
    }
    const made = this.draw(body, skin, hair, look, pose, size)
    this.cache.set(key, made)
    return made
  }

  /** Destroys retired textures; call only after every sprite has been re-pointed at current ones. */
  destroyRetired() {
    for (const entry of this.retired) entry.texture.destroy(true)
    this.retired = []
  }

  clear() {
    this.destroyRetired()
    for (const entry of this.cache.values()) entry.texture.destroy(true)
    this.cache.clear()
  }

  private draw(body: string, skin: string, hair: string, look: FigureLook, pose: FigurePose, size: number): FigureTexture {
    // Figure units: feet at y=0, top of the hair at about y=-15 (16 units tall).
    const scale = size / 16
    const step = pose === 'stepA' ? 1 : pose === 'stepB' ? -1 : 0
    const g = new Graphics()
    if (pose !== 'fallen') g.ellipse(1, 1, 3.8, 1.6).fill({ color: '#233D29', alpha: 0.12 })
    g.moveTo(-1.25, -4).lineTo(-1.8 - step * 1.25, 0).moveTo(1.25, -4).lineTo(1.8 + step * 1.25, 0)
      .stroke({ width: 1.6, color: '#405052', cap: 'round' })
    g.moveTo(-2.5, -9).lineTo(-3.2 + step, -5.5).moveTo(2.5, -9).lineTo(3.2 - step, -5.5)
      .stroke({ width: 1.5, color: skin, cap: 'round' })
    g.roundRect(-2.6, -10, 5.2, 6.8, 2).fill(body)
    // A skirt or dress flares out over the tops of the legs, in the outfit colour.
    if (look.outfit === 'skirt') g.poly([-2.6, -5.6, 2.6, -5.6, 3.5 - step * 0.3, -2.1, -3.5 - step * 0.3, -2.1]).fill(body)
    // Hair that sits behind the head is drawn before it: long hair to the shoulders, a ponytail.
    if (look.hair === 'long') g.roundRect(-2.55, -14.7, 5.1, 6.1, 2.4).fill(hair)
    if (look.hair === 'ponytail') g.ellipse(2.5, -12.2, 0.95, 1.9).fill(hair)
    g.circle(0, -12.4, 2.2).fill(skin)
    g.ellipse(-0.2, -13.6, 2.15, 1.2).fill(hair)
    if (look.hair === 'bun') g.circle(0, -15.1, 1.25).fill(hair)
    g.scale.set(scale)

    const holder = new Container()
    holder.addChild(g)
    // A fallen person lies on their side, torso still on their position.
    if (pose === 'fallen') g.rotation = Math.PI / 2
    const bounds = holder.getLocalBounds()
    const torso = pose === 'fallen' ? { x: 7 * scale, y: 0 } : { x: 0, y: -7 * scale }
    const texture = this.renderer.generateTexture({ target: holder, resolution: Math.max(2, window.devicePixelRatio || 1), antialias: true })
    holder.destroy({ children: true })
    return {
      texture,
      anchorX: (torso.x - bounds.x) / bounds.width,
      anchorY: (torso.y - bounds.y) / bounds.height,
      height: bounds.height,
    }
  }
}
