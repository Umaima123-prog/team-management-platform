import type { ApiErrorBody } from './types'

/** Points at the real NestJS Management Service - never a mock, never
 * a direct read of insights_db (see docs/ARCHITECTURE.md "Trust
 * boundary"). Configurable so the UI can be pointed at a deployed API
 * without a rebuild. */
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3000'

/** A typed, user-safe error - `message` always comes from the
 * server's own clean error envelope (never a raw stack trace or
 * internal detail - see docs/API.md "Error envelope"), or from a
 * small fixed set of client-side network/parsing messages this module
 * writes itself. Never includes secrets: this client never sends or
 * logs anything beyond the dev-user id already visible in the UI. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }

  get isNotFound(): boolean {
    return this.status === 404
  }

  get isVersionConflict(): boolean {
    return this.status === 409
  }

  get isValidationError(): boolean {
    return this.status === 400
  }

  get isNetworkError(): boolean {
    return this.status === 0
  }

  /** The server's reported current version on a 409 - see
   * docs/API.md "Optimistic concurrency". */
  get currentVersion(): number | undefined {
    const details = this.details as { currentVersion?: number } | undefined
    return details?.currentVersion
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  userId: string
  signal?: AbortSignal
}

function randomCorrelationId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `corr-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** The one place every HTTP call to the Management Service goes
 * through - consistent headers (X-Dev-User-Id, X-Correlation-Id),
 * consistent error shape, never a raw/unhandled fetch exception
 * reaching a component. */
export async function apiRequest<T>(path: string, options: RequestOptions): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Dev-User-Id': options.userId,
        'X-Correlation-Id': randomCorrelationId(),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    })
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Check your connection and try again.')
  }

  const text = await response.text()
  let payload: unknown = undefined
  if (text.length > 0) {
    try {
      payload = JSON.parse(text)
    } catch {
      throw new ApiError(
        response.status,
        'MALFORMED_RESPONSE',
        'The server returned a response that could not be read.',
      )
    }
  }

  if (!response.ok) {
    const errorBody = (payload as { error?: ApiErrorBody } | undefined)?.error
    throw new ApiError(
      response.status,
      errorBody?.code ?? 'UNKNOWN_ERROR',
      errorBody?.message ?? `Request failed with status ${response.status}.`,
      errorBody?.details,
    )
  }

  return payload as T
}
