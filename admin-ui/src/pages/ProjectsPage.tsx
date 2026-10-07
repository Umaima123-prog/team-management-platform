import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useCurrentUser } from '../context/CurrentUserContext'
import { useAsync } from '../hooks/useAsync'
import { createProject, listProjects, listTeams, listUsers } from '../api/endpoints'
import { ErrorAlert, errorMessage } from '../components/common/ErrorAlert'
import { LoadingSpinner } from '../components/common/LoadingSpinner'
import { useToast } from '../context/ToastContext'

export function ProjectsPage(): React.ReactElement {
  const { currentUser } = useCurrentUser()
  const userId = currentUser?.id ?? ''
  const { data, loading, error, reload } = useAsync(
    (signal) => listProjects({ userId, signal }),
    [userId],
  )
  const { data: teamsPage } = useAsync((signal) => listTeams({ userId, signal }), [userId])
  const { data: usersPage } = useAsync((signal) => listUsers({ userId, signal }), [userId])
  const { showToast } = useToast()

  const [projectKey, setProjectKey] = useState('')
  const [name, setName] = useState('')
  const [teamId, setTeamId] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setSubmitError(null)
    setSubmitting(true)
    try {
      await createProject({ userId }, { projectKey, name, teamId, ownerId: ownerId || userId })
      setProjectKey('')
      setName('')
      setTeamId('')
      setOwnerId('')
      showToast('success', `Project "${name}" created.`)
      reload()
    } catch (err) {
      setSubmitError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <h1 className="h3 mb-4">Projects</h1>

      <div className="card mb-4">
        <div className="card-body">
          <h2 className="h6">Create a project</h2>
          <form onSubmit={handleSubmit} className="row g-2 align-items-end">
            <div className="col-sm-2">
              <label htmlFor="project-key" className="form-label">
                Key
              </label>
              <input
                id="project-key"
                className="form-control"
                value={projectKey}
                onChange={(e) => setProjectKey(e.target.value.toUpperCase())}
                maxLength={10}
                required
              />
            </div>
            <div className="col-sm-3">
              <label htmlFor="project-name" className="form-label">
                Name
              </label>
              <input
                id="project-name"
                className="form-control"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="col-sm-3">
              <label htmlFor="project-team" className="form-label">
                Owning team
              </label>
              <select
                id="project-team"
                className="form-select"
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
                required
              >
                <option value="">Select a team…</option>
                {(teamsPage?.items ?? [])
                  .filter((t) => !t.archivedAt)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="col-sm-3">
              <label htmlFor="project-owner" className="form-label">
                Owner
              </label>
              <select
                id="project-owner"
                className="form-select"
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
              >
                <option value="">Me ({currentUser?.name})</option>
                {(usersPage?.items ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-sm-1">
              <button type="submit" className="btn btn-primary w-100" disabled={submitting}>
                {submitting ? '…' : 'Add'}
              </button>
            </div>
          </form>
          {submitError && (
            <div className="alert alert-danger mt-3 mb-0" role="alert">
              {submitError}
            </div>
          )}
        </div>
      </div>

      {loading && <LoadingSpinner label="Loading projects…" />}
      {error && <ErrorAlert error={error} onRetry={reload} />}
      {data && (
        <div className="card">
          <table className="table mb-0">
            <thead>
              <tr>
                <th scope="col">Project</th>
                <th scope="col">Status</th>
                <th scope="col">Start</th>
                <th scope="col">End</th>
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              {data.items.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-muted">
                    No projects yet.
                  </td>
                </tr>
              )}
              {data.items.map((project) => (
                <tr key={project.id}>
                  <td>
                    <Link to={`/projects/${project.id}`}>{project.name}</Link>{' '}
                    <span className="text-muted small">({project.projectKey})</span>
                  </td>
                  <td>
                    <span
                      className={`badge text-bg-${project.status === 'ACTIVE' ? 'success' : 'secondary'}`}
                    >
                      {project.status}
                    </span>
                  </td>
                  <td>{project.startDate ? new Date(project.startDate).toLocaleDateString() : '—'}</td>
                  <td>{project.endDate ? new Date(project.endDate).toLocaleDateString() : '—'}</td>
                  <td>
                    <Link to={`/projects/${project.id}`} className="btn btn-sm btn-outline-primary">
                      Open board
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
