import { ApiError } from '../../api/client'

/** Renders any caught error as a clean, user-safe message - never a
 * stack trace, never an internal exception name. `ApiError`s already
 * carry a server-cleaned message (docs/API.md "Error envelope");
 * anything else (a network failure, a programming error) falls back
 * to a generic, non-alarming message rather than `error.stack`. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.isNetworkError) {
      return 'Could not reach the server. Check your connection and that the API is running.'
    }
    if (error.isNotFound) {
      return 'Not found - it may have been archived or deleted.'
    }
    if (error.isVersionConflict) {
      return 'Someone else changed this since you last loaded it.'
    }
    return error.message
  }
  return 'Something went wrong. Please try again.'
}

export function ErrorAlert({
  error,
  onRetry,
}: {
  error: unknown
  onRetry?: () => void
}): React.ReactElement {
  return (
    <div className="alert alert-danger d-flex align-items-center justify-content-between" role="alert">
      <span>{errorMessage(error)}</span>
      {onRetry && (
        <button type="button" className="btn btn-sm btn-outline-danger ms-3" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  )
}
