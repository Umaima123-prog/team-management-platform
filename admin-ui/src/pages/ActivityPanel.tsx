import { useAsync } from '../hooks/useAsync'
import { getProjectActivity, listUsers } from '../api/endpoints'
import type { ProjectActivityEntry } from '../api/types'
import { ErrorAlert } from '../components/common/ErrorAlert'
import { LoadingSpinner } from '../components/common/LoadingSpinner'

/** Human-readable label for an event type, e.g. "workitem.moved" ->
 * "moved" - text only, never HTML. */
function actionLabel(eventType: string): string {
  const parts = eventType.split('.')
  return parts[parts.length - 1] ?? eventType
}

/** The affected item, in the most readable form the real event/
 * projection data actually supports - issueKey when available
 * (resolved server-side from item_state, never management_db),
 * falling back to the raw aggregate type+id otherwise (e.g. for
 * Team/Project/Board aggregates, or a WorkItem whose "created" event
 * hasn't been processed yet). Deliberately never a free-text title:
 * this project's events never carry one (docs/ARCHITECTURE.md
 * "Events are facts... without exposing secrets"), so showing one
 * here would require reading management_db directly, which this UI
 * must never do. */
function affectedItemLabel(entry: ProjectActivityEntry): string {
  if (entry.aggregateType === 'WorkItem' && entry.issueKey) {
    return entry.issueKey
  }
  return `${entry.aggregateType} ${entry.aggregateId}`
}

export function ActivityPanel({ projectId }: { projectId: string }): React.ReactElement {
  const { data, loading, error, reload } = useAsync(
    (signal) => getProjectActivity({ signal }, projectId),
    [projectId],
  )
  const { data: usersPage } = useAsync((signal) => listUsers({ signal }), [])

  function userName(id: string): string {
    return usersPage?.items.find((u) => u.id === id)?.name ?? id
  }

  if (loading) return <LoadingSpinner label="Loading activity…" />
  if (error) return <ErrorAlert error={error} onRetry={reload} />
  if (!data) return <></>

  if (data.status === 'not_ready') {
    return (
      <div className="alert alert-info" role="status">
        Activity isn&rsquo;t available for this project yet ({data.reason}). This view reflects the
        real, asynchronously-built projection - it can lag a few seconds behind the Management
        Service.
      </div>
    )
  }
  if (data.status === 'pending') {
    return (
      <div className="alert alert-secondary" role="status">
        The activity query timed out waiting for a reply. Try again in a moment.
        <button type="button" className="btn btn-sm btn-outline-secondary ms-3" onClick={reload}>
          Retry
        </button>
      </div>
    )
  }
  if (data.status === 'unavailable') {
    return (
      <div className="alert alert-warning" role="status">
        Activity is temporarily unavailable ({data.reason}).
        <button type="button" className="btn btn-sm btn-outline-secondary ms-3" onClick={reload}>
          Retry
        </button>
      </div>
    )
  }

  return (
    <div>
      <p className="text-muted small">
        Last processed stream sequence: {data.data.lastProcessedSequence ?? '—'}
      </p>
      <ol className="list-group list-group-flush" aria-label="Project activity, most recent first">
        {data.data.entries.length === 0 && (
          <li className="list-group-item text-muted">No activity recorded yet.</li>
        )}
        {data.data.entries.map((entry) => (
          <li key={entry.eventId} className="list-group-item">
            <strong>{userName(entry.actorId)}</strong> {actionLabel(entry.eventType)}{' '}
            <span className="text-muted">{affectedItemLabel(entry)}</span>
            <div className="text-muted small">{new Date(entry.occurredAt).toLocaleString()}</div>
          </li>
        ))}
      </ol>
    </div>
  )
}
