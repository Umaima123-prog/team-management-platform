import { useState, type FormEvent } from 'react'
import { createWorkItem } from '../../api/endpoints'
import type { Membership, User } from '../../api/types'
import { errorMessage } from '../../components/common/ErrorAlert'

export function CreateItemForm({
  userId,
  projectId,
  teamMembers,
  users,
  onCreated,
}: {
  userId: string
  projectId: string
  teamMembers: Membership[]
  users: User[]
  onCreated: () => void
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [type, setType] = useState('TASK')
  const [priority, setPriority] = useState('MEDIUM')
  const [assigneeId, setAssigneeId] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function userName(id: string): string {
    return users.find((u) => u.id === id)?.name ?? id
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setSubmitError(null)
    setSubmitting(true)
    try {
      await createWorkItem({ userId }, projectId, {
        title,
        type,
        priority,
        assigneeId: assigneeId || undefined,
      })
      setTitle('')
      setAssigneeId('')
      setOpen(false)
      onCreated()
    } catch (err) {
      setSubmitError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-primary btn-sm mb-3" onClick={() => setOpen(true)}>
        + New item
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="card card-body mb-3">
      <div className="row g-2 align-items-end">
        <div className="col-sm-4">
          <label htmlFor="new-item-title" className="form-label">
            Title
          </label>
          <input
            id="new-item-title"
            className="form-control"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            autoFocus
          />
        </div>
        <div className="col-sm-2">
          <label htmlFor="new-item-type" className="form-label">
            Type
          </label>
          <select id="new-item-type" className="form-select" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="TASK">TASK</option>
            <option value="BUG">BUG</option>
            <option value="STORY">STORY</option>
          </select>
        </div>
        <div className="col-sm-2">
          <label htmlFor="new-item-priority" className="form-label">
            Priority
          </label>
          <select
            id="new-item-priority"
            className="form-select"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          >
            <option value="LOW">LOW</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="HIGH">HIGH</option>
            <option value="URGENT">URGENT</option>
          </select>
        </div>
        <div className="col-sm-2">
          {/* Restricted to the project's owning team - same rule the
              server enforces (400 otherwise); the UI only ever offers
              choices the server would accept. */}
          <label htmlFor="new-item-assignee" className="form-label">
            Assignee
          </label>
          <select
            id="new-item-assignee"
            className="form-select"
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
          >
            <option value="">Unassigned</option>
            {teamMembers.map((m) => (
              <option key={m.userId} value={m.userId}>
                {userName(m.userId)}
              </option>
            ))}
          </select>
        </div>
        <div className="col-sm-2 d-flex gap-2">
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? '…' : 'Create'}
          </button>
          <button type="button" className="btn btn-outline-secondary" onClick={() => setOpen(false)}>
            Cancel
          </button>
        </div>
      </div>
      {submitError && (
        <div className="alert alert-danger mt-2 mb-0" role="alert">
          {submitError}
        </div>
      )}
    </form>
  )
}
