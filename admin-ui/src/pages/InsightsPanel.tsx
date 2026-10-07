import { useCurrentUser } from '../context/CurrentUserContext'
import { useAsync } from '../hooks/useAsync'
import { getBoard, getProjectInsights, listUsers } from '../api/endpoints'
import { ErrorAlert } from '../components/common/ErrorAlert'
import { LoadingSpinner } from '../components/common/LoadingSpinner'

const STALE_AFTER_MS = 60_000

export function InsightsPanel({ projectId }: { projectId: string }): React.ReactElement {
  const { currentUser } = useCurrentUser()
  const userId = currentUser?.id ?? ''
  const { data, loading, error, reload } = useAsync(
    (signal) => getProjectInsights({ userId, signal }, projectId),
    [userId, projectId],
  )
  const { data: usersPage } = useAsync((signal) => listUsers({ userId, signal }), [userId])
  const { data: board } = useAsync((signal) => getBoard({ userId, signal }, projectId), [
    userId,
    projectId,
  ])

  function userName(id: string | null): string {
    if (!id) return 'Unassigned'
    return usersPage?.items.find((u) => u.id === id)?.name ?? id
  }

  function columnName(columnId: string): string {
    return board?.columns.find((c) => c.id === columnId)?.name ?? columnId
  }

  if (loading) return <LoadingSpinner label="Loading insights…" />
  if (error) return <ErrorAlert error={error} onRetry={reload} />
  if (!data) return <></>

  if (data.status === 'not_ready') {
    return (
      <div className="alert alert-info" role="status">
        <strong>Not ready yet.</strong> This project has no workload data yet ({data.reason}) - this
        is an asynchronous projection, not an instant read; it can take a moment after the first
        event. It is never made to look instantly consistent.
      </div>
    )
  }
  if (data.status === 'pending') {
    return (
      <div className="alert alert-secondary" role="status">
        <strong>Pending.</strong> The insights query timed out waiting for a reply.
        <button type="button" className="btn btn-sm btn-outline-secondary ms-3" onClick={reload}>
          Retry
        </button>
      </div>
    )
  }
  if (data.status === 'unavailable') {
    return (
      <div className="alert alert-warning" role="status">
        <strong>Temporarily unavailable.</strong> ({data.reason})
        <button type="button" className="btn btn-sm btn-outline-secondary ms-3" onClick={reload}>
          Retry
        </button>
      </div>
    )
  }

  const generatedAgoMs = Date.now() - new Date(data.data.generatedAt).getTime()
  const stale = generatedAgoMs > STALE_AFTER_MS

  return (
    <div>
      <div className="d-flex align-items-center gap-2 mb-3">
        <span className={`badge text-bg-${stale ? 'warning' : 'success'}`}>
          {stale ? 'Stale' : 'Ready'}
        </span>
        <span className="text-muted small">
          Generated {new Date(data.data.generatedAt).toLocaleTimeString()} - last processed
          sequence {data.data.lastProcessedSequence ?? '—'}
        </span>
      </div>

      <div className="row">
        <div className="col-md-4">
          <h3 className="h6">Workload by assignee</h3>
          <ul className="list-group list-group-flush">
            {data.data.workloadByAssignee.map((row) => (
              <li
                key={row.assigneeId ?? 'unassigned'}
                className="list-group-item d-flex justify-content-between"
              >
                <span>{userName(row.assigneeId)}</span>
                <span className="badge text-bg-primary">{row.count}</span>
              </li>
            ))}
            {data.data.workloadByAssignee.length === 0 && (
              <li className="list-group-item text-muted">No data.</li>
            )}
          </ul>
        </div>
        <div className="col-md-4">
          <h3 className="h6">Counts by column/status</h3>
          <ul className="list-group list-group-flush">
            {data.data.countsByStatus.map((row) => (
              <li key={row.columnId} className="list-group-item d-flex justify-content-between">
                <span className="text-truncate" style={{ maxWidth: '70%' }}>
                  {columnName(row.columnId)}
                </span>
                <span className="badge text-bg-primary">{row.count}</span>
              </li>
            ))}
            {data.data.countsByStatus.length === 0 && (
              <li className="list-group-item text-muted">No data.</li>
            )}
          </ul>
        </div>
        {data.data.workloadByPriority && (
          <div className="col-md-4">
            <h3 className="h6">Workload by priority</h3>
            <ul className="list-group list-group-flush">
              {data.data.workloadByPriority.map((row) => (
                <li key={row.priority} className="list-group-item d-flex justify-content-between">
                  <span>{row.priority}</span>
                  <span className="badge text-bg-primary">{row.count}</span>
                </li>
              ))}
              {data.data.workloadByPriority.length === 0 && (
                <li className="list-group-item text-muted">No data.</li>
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
