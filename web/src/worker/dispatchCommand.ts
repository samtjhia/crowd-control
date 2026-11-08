import { IdSchema, parseWorkerCommand, parseWorkerMessage, type ContractError, type WasmEngineBindings, type WorkerMessage } from '@crowd-control/contract'

export function commandError(raw: unknown, error: ContractError): WorkerMessage {
  const field = (key: string) => {
    const value: unknown = raw && typeof raw === 'object' ? Object.getOwnPropertyDescriptor(raw, key)?.value : undefined
    const result = IdSchema.safeParse(value)
    return result.success ? result.data : undefined
  }
  const commandId = field('commandId')
  return { schemaVersion: 1, simulationId: field('simulationId') ?? 'unknown', type: 'error', ...(commandId ? { commandId } : {}), error }
}

export function dispatchCommand(bindings: WasmEngineBindings, handle: number, raw: unknown): WorkerMessage[] {
  const parsed = parseWorkerCommand(raw)
  if (!parsed.ok) return [commandError(raw, parsed.error)]
  const json = bindings.dispatch(handle, JSON.stringify(parsed.value))
  const messages: unknown = JSON.parse(json)
  if (!Array.isArray(messages) || messages.length > 1000) throw new Error('Invalid engine message batch')
  return messages.map((message) => {
    const result = parseWorkerMessage(message)
    if (!result.ok) throw new Error(`Invalid engine message: ${result.error.message}`)
    if (result.value.simulationId !== parsed.value.simulationId) throw new Error('Engine simulationId mismatch')
    if ('commandId' in result.value && result.value.commandId !== undefined && result.value.commandId !== parsed.value.commandId) throw new Error('Engine commandId mismatch')
    return result.value
  })
}
