import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../api/client'

export interface AsyncState<T> {
  data: T | null
  loading: boolean
  error: ApiError | Error | null
  reload: () => void
}

/** Runs `fn` on mount and whenever `deps` change, tracking loading/
 * error/data state and aborting an in-flight request if the
 * component re-runs the effect or unmounts first - so a slow
 * response for a since-abandoned project id can never clobber the
 * state of whatever is now showing. */
export function useAsync<T>(fn: (signal: AbortSignal) => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ApiError | Error | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    fnRef
      .current(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        setData(result)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err : new Error('Unknown error'))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps is the caller's explicit dependency list
  }, [...deps, reloadToken])

  const reload = useCallback(() => setReloadToken((t) => t + 1), [])

  return { data, loading, error, reload }
}
