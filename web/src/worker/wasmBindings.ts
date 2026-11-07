import { ABI_VERSION, type WasmEngineBindings } from '@crowd-control/contract'

export const ENGINE_VERSION = 'metrics-engine-v7'
type RawExports = WebAssembly.Exports & {
  memory: WebAssembly.Memory
  abi_version(): number
  engine_version_ptr(): number
  engine_version_len(): number
  create_engine(): number
  destroy_engine(handle: number): void
  alloc_json(length: number): number
  free_json(pointer: number, length: number): void
  dispatch_json(handle: number, pointer: number, length: number): number
  response_len(): number
}

/** Pointers stay private to this binding; the rest of the app uses strings/handles. */
export async function instantiateEngine(bytes: BufferSource): Promise<WasmEngineBindings> {
  const { instance } = await WebAssembly.instantiate(bytes, {})
  const raw = instance.exports as RawExports
  for (const name of ['abi_version', 'engine_version_ptr', 'engine_version_len', 'create_engine', 'destroy_engine', 'alloc_json', 'free_json', 'dispatch_json', 'response_len']) {
    if (typeof raw[name] !== 'function') throw new Error(`Missing Wasm export: ${name}`)
  }
  if (!(raw.memory instanceof WebAssembly.Memory)) throw new Error('Missing Wasm memory')
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const engineVersion = decoder.decode(new Uint8Array(raw.memory.buffer, raw.engine_version_ptr() >>> 0, raw.engine_version_len() >>> 0))
  if (raw.abi_version() !== ABI_VERSION || engineVersion !== ENGINE_VERSION) throw new Error('Incompatible engine ABI/build')
  const handles = new Set<number>()
  return {
    abi_version: () => raw.abi_version(),
    engine_version: () => engineVersion,
    create_engine() {
      const handle = raw.create_engine() >>> 0
      if (!Number.isInteger(handle) || handle <= 0 || handle > 0xffff_ffff) throw new Error('Engine handle allocation failed')
      handles.add(handle)
      return handle
    },
    destroy_engine(handle) {
      if (handles.delete(handle)) raw.destroy_engine(handle)
    },
    dispatch(handle, json) {
      if (!handles.has(handle)) throw new Error('Invalid or destroyed engine handle')
      const encoded = new TextEncoder().encode(json)
      if (encoded.length === 0 || encoded.length > 32 * 1024 * 1024) throw new Error('Command exceeds Wasm input budget')
      const ptr = raw.alloc_json(encoded.length) >>> 0
      if (ptr === 0) throw new Error('Wasm allocation failed')
      try {
        new Uint8Array(raw.memory.buffer, ptr, encoded.length).set(encoded)
        const resultPtr = raw.dispatch_json(handle, ptr, encoded.length) >>> 0
        const length = raw.response_len() >>> 0
        if (length > 32 * 1024 * 1024) throw new Error('Wasm response exceeds output budget')
        // Decode before another call can replace the engine's response buffer.
        return decoder.decode(new Uint8Array(raw.memory.buffer, resultPtr, length))
      } finally {
        raw.free_json(ptr, encoded.length)
      }
    },
  }
}

export async function loadWasmEngine(url: string): Promise<WasmEngineBindings> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Cannot load engine (${response.status}); run npm run build:wasm`)
  return instantiateEngine(await response.arrayBuffer())
}
