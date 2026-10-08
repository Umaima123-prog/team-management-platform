import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useAsync } from '../hooks/useAsync'
import { ApiError } from '../api/client'
import { createTeam, listTeams } from '../api/endpoints'
import { ErrorAlert, errorMessage } from '../components/common/ErrorAlert'
import { LoadingSpinner } from '../components/common/LoadingSpinner'
import { useToast } from '../context/ToastContext'

export function TeamsPage(): React.ReactElement {
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'
  const { data, loading, error, reload } = useAsync((signal) => listTeams({ signal }), [])
  const { showToast } = useToast()

  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setSubmitError(null)
    setSubmitting(true)
    try {
      await createTeam({}, { code, name, description: description || undefined })
      setCode('')
      setName('')
      setDescription('')
      showToast('success', `Team "${name}" created.`)
      reload()
    } catch (err) {
      setSubmitError(errorMessage(err) + validationDetails(err))
    } finally {
      setSubmitting(false)
    }
  }

  function validationDetails(err: unknown): string {
    if (err instanceof ApiError && Array.isArray(err.details)) {
      return ' ' + (err.details as string[]).join(' ')
    }
    return ''
  }

  return (
    <div>
      <h1 className="h3 mb-4">Teams</h1>

      {isAdmin && (
        <div className="card mb-4">
          <div className="card-body">
            <h2 className="h6">Create a team</h2>
            <form onSubmit={handleSubmit} className="row g-2 align-items-end">
              <div className="col-sm-3">
                <label htmlFor="team-code" className="form-label">
                  Code
                </label>
                <input
                  id="team-code"
                  className="form-control"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  maxLength={10}
                  required
                />
              </div>
              <div className="col-sm-4">
                <label htmlFor="team-name" className="form-label">
                  Name
                </label>
                <input
                  id="team-name"
                  className="form-control"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div className="col-sm-4">
                <label htmlFor="team-description" className="form-label">
                  Description
                </label>
                <input
                  id="team-description"
                  className="form-control"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
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
      )}

      {loading && <LoadingSpinner label="Loading teams…" />}
      {error && <ErrorAlert error={error} onRetry={reload} />}
      {data && (
        <div className="card">
          <ul className="list-group list-group-flush">
            {data.items.length === 0 && (
              <li className="list-group-item text-muted">No teams yet.</li>
            )}
            {data.items.map((team) => (
              <li key={team.id} className="list-group-item d-flex justify-content-between align-items-center">
                <div>
                  <Link to={`/teams/${team.id}`}>{team.name}</Link>{' '}
                  <span className="text-muted small">({team.code})</span>
                  {team.description && <div className="text-muted small">{team.description}</div>}
                </div>
                {team.archivedAt && <span className="badge text-bg-secondary">Archived</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
