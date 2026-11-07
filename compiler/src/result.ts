import type { ContractError, ErrorCode, Result } from '@crowd-control/contract'

/** A failed compile with a contract error code (Technical PRD §13). */
export function fail(code: ErrorCode, message: string, extra: Omit<ContractError, 'code' | 'message'> = {}): Result<never> {
  return { ok: false, error: { code, message, ...extra } }
}

export function ok<T>(value: T): Result<T> {
  return { ok: true, value }
}
