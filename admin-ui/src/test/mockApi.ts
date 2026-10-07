import { vi } from 'vitest'

export interface MockRoute {
  method?: string
  /** Matches the request path (no base URL, no query string). */
  path: string | RegExp
  handler: (ctx: { url: URL; body: unknown }) => { status?: number; body?: unknown }
}

/** Installs a `fetch` mock matching requests against an ordered list
 * of routes (first match wins) - enough to drive every endpoint this
 * app calls without a real server, while still exercising the real
 * `apiRequest`/`ApiError` parsing logic. Throws loudly on an
 * unmatched request so a missing mock is never silently a hang. */
export function installMockFetch(routes: MockRoute[]): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const method = (init?.method ?? 'GET').toUpperCase()
    const body = init?.body ? JSON.parse(String(init.body)) : undefined

    for (const route of routes) {
      const methodMatches = (route.method ?? 'GET').toUpperCase() === method
      const pathMatches =
        typeof route.path === 'string' ? url.pathname === route.path : route.path.test(url.pathname)
      if (methodMatches && pathMatches) {
        const result = route.handler({ url, body })
        return new Response(result.body !== undefined ? JSON.stringify(result.body) : '', {
          status: result.status ?? 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }
    throw new Error(`Unmocked request: ${method} ${url.pathname}${url.search}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

export function errorBody(code: string, message: string, details?: unknown) {
  return { error: { code, message, details } }
}
