import { Link } from 'react-router-dom'
import { useCurrentUser } from '../context/CurrentUserContext'
import { useAsync } from '../hooks/useAsync'
import { ErrorAlert } from '../components/common/ErrorAlert'
import { LoadingSpinner } from '../components/common/LoadingSpinner'
import { getBoard, getProjectInsights, listProjects, listTeams, listWorkItems } from '../api/endpoints'
import type { Project } from '../api/types'

interface DashboardStats {
  teamCount: number
  activeProjectCount: number
  openItemCount: number
  overdueItemCount: number
  scannedProjectCount: number
  totalActiveProjectCount: number
}

/** A dev-tool-scale dashboard: it scans up to this many active
 * projects' items/boards to compute open/overdue counts. There is no
 * cross-project items endpoint, so this is N+1 requests by design -
 * bounded, not paginated, and honestly labeled when truncated. */
const MAX_PROJECTS_SCANNED = 20

async function loadStats(userId: string, signal: AbortSignal): Promise<DashboardStats> {
  const [teamsPage, projectsPage] = await Promise.all([
    listTeams({ userId, signal }),
    listProjects({ userId, signal }),
  ])

  const activeProjects = projectsPage.items.filter((p) => !p.archivedAt)
  const scanned = activeProjects.slice(0, MAX_PROJECTS_SCANNED)

  let openItemCount = 0
  let overdueItemCount = 0
  const now = Date.now()

  await Promise.all(
    scanned.map(async (project: Project) => {
      const [board, itemsPage] = await Promise.all([
        getBoard({ userId, signal }, project.id),
        listWorkItems({ userId, signal }, project.id, { includeArchived: false, limit: 100 }),
      ])
      const doneColumnId = board.columns.reduce(
        (max, col) => (col.order > max.order ? col : max),
        board.columns[0],
      )?.id
      for (const item of itemsPage.items) {
        if (item.columnId !== doneColumnId) openItemCount += 1
        if (item.dueDate && new Date(item.dueDate).getTime() < now) overdueItemCount += 1
      }
    }),
  )

  return {
    teamCount: teamsPage.items.length,
    activeProjectCount: activeProjects.length,
    openItemCount,
    overdueItemCount,
    scannedProjectCount: scanned.length,
    totalActiveProjectCount: activeProjects.length,
  }
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string
  value: string | number
  color: string
}): React.ReactElement {
  return (
    <div className="col-sm-6 col-lg-3 mb-3">
      <div className="small-box" style={{ backgroundColor: color }}>
        <div className="small-box-value" data-testid={`stat-${label}`}>
          {value}
        </div>
        <div className="small-box-label">{label}</div>
      </div>
    </div>
  )
}

function FreshnessPanel({ userId, projectId }: { userId: string; projectId: string }): React.ReactElement {
  const { data, loading, error } = useAsync(
    (signal) => getProjectInsights({ userId, signal }, projectId),
    [userId, projectId],
  )

  if (loading) return <LoadingSpinner label="Checking projection freshness…" />
  if (error) return <ErrorAlert error={error} />
  if (!data) return <></>

  if (data.status === 'ok') {
    return (
      <span className="badge text-bg-success">
        Ready - last processed sequence {data.data.lastProcessedSequence ?? '—'}
      </span>
    )
  }
  if (data.status === 'not_ready') {
    return <span className="badge text-bg-warning">Not ready yet ({data.reason})</span>
  }
  if (data.status === 'pending') {
    return <span className="badge text-bg-secondary">Pending (query timed out)</span>
  }
  return <span className="badge text-bg-danger">Temporarily unavailable ({data.reason})</span>
}

export function DashboardPage(): React.ReactElement {
  const { currentUser } = useCurrentUser()
  const userId = currentUser?.id ?? ''
  const { data, loading, error, reload } = useAsync((signal) => loadStats(userId, signal), [userId])

  const { data: projectsForFreshness } = useAsync(
    (signal) => listProjects({ userId, signal }),
    [userId],
  )
  const sampleProject = projectsForFreshness?.items.find((p) => !p.archivedAt) ?? null

  return (
    <div>
      <h1 className="h3 mb-4">Dashboard</h1>
      {loading && <LoadingSpinner label="Loading dashboard stats…" />}
      {error && <ErrorAlert error={error} onRetry={reload} />}
      {data && (
        <>
          <div className="row">
            <StatCard label="Teams" value={data.teamCount} color="#0d6efd" />
            <StatCard label="Active projects" value={data.activeProjectCount} color="#198754" />
            <StatCard label="Open work items" value={data.openItemCount} color="#6f42c1" />
            <StatCard label="Overdue items" value={data.overdueItemCount} color="#dc3545" />
          </div>
          {data.scannedProjectCount < data.totalActiveProjectCount && (
            <p className="text-muted small">
              Open/overdue counts are based on the first {data.scannedProjectCount} of{' '}
              {data.totalActiveProjectCount} active projects.
            </p>
          )}
        </>
      )}

      <div className="card mt-3">
        <div className="card-body">
          <h2 className="h6">Projection freshness</h2>
          {sampleProject ? (
            <>
              <p className="text-muted small mb-2">
                Shown for{' '}
                <Link to={`/projects/${sampleProject.id}`}>{sampleProject.name}</Link> - visit any
                project&rsquo;s Insights tab for its own freshness.
              </p>
              <FreshnessPanel userId={userId} projectId={sampleProject.id} />
            </>
          ) : (
            <p className="text-muted small mb-0">
              No active projects yet - create one to see projection freshness here.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
