import { useEffect, useRef, useState } from 'react'
import { useCurrentUser } from '../context/CurrentUserContext'
import { assignWorkItem, updateWorkItem } from '../api/endpoints'
import { ApiError } from '../api/client'
import type { Membership, User, WorkItem } from '../api/types'
import { errorMessage } from '../components/common/ErrorAlert'
import { useToast } from '../context/ToastContext'

interface ItemDrawerProps {
  item: WorkItem
  teamMembers: Membership[]
  users: User[]
  onClose: () => void
  onUpdated: () => void
}

/**
 * Edits a single work item. Every field change is sent to the real
 * NestJS API with the item's current `expectedVersion` - never a
 * frontend-only edit. Assignee choices are restricted to the
 * project's owning team's active members (the same rule
 * `WorkItemsService.assertAssigneeEligible` enforces server-side, see
 * docs/API.md "POST /api/items/:itemId/assign") - this narrows the
 * UI, it does not and must not replace the server check.
 */
export function ItemDrawer({ item, teamMembers, users, onClose, onUpdated }: ItemDrawerProps): React.ReactElement {
  const { currentUser } = useCurrentUser()
  const userId = currentUser?.id ?? ''
  const { showToast } = useToast()
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  const [title, setTitle] = useState(item.title)
  const [description, setDescription] = useState(item.description ?? '')
  const [type, setType] = useState<string>(item.type)
  const [priority, setPriority] = useState<string>(item.priority)
  const [labelsText, setLabelsText] = useState(item.labels.join(', '))
  const [dueDate, setDueDate] = useState(item.dueDate ? item.dueDate.slice(0, 10) : '')
  const [assigneeId, setAssigneeId] = useState(item.assigneeId ?? '')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    closeButtonRef.current?.focus()
  }, [])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  function userName(id: string | null): string {
    if (!id) return 'Unassigned'
    return users.find((u) => u.id === id)?.name ?? id
  }

  async function handleSave(): Promise<void> {
    setSaveError(null)
    setSaving(true)
    try {
      let version = item.version

      if (assigneeId !== (item.assigneeId ?? '')) {
        const updated = await assignWorkItem({ userId }, item.id, version, assigneeId || null)
        version = updated.version
      }

      const labels = labelsText
        .split(',')
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
      const fieldsChanged =
        title !== item.title ||
        description !== (item.description ?? '') ||
        type !== item.type ||
        priority !== item.priority ||
        labelsText !== item.labels.join(', ') ||
        dueDate !== (item.dueDate ? item.dueDate.slice(0, 10) : '')

      if (fieldsChanged) {
        await updateWorkItem({ userId }, item.id, {
          expectedVersion: version,
          title,
          description: description || null,
          type,
          priority,
          labels,
          dueDate: dueDate ? new Date(dueDate).toISOString() : null,
        })
      }

      showToast('success', `${item.issueKey} updated.`)
      onUpdated()
      onClose()
    } catch (err) {
      if (err instanceof ApiError && err.isVersionConflict) {
        showToast('warning', 'This item changed on the server since it was opened - refreshing.')
        onUpdated()
        onClose()
      } else {
        setSaveError(errorMessage(err))
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="position-fixed top-0 end-0 bottom-0 bg-white shadow-lg border-start"
      style={{ width: 'min(420px, 100vw)', zIndex: 1050, overflowY: 'auto' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="item-drawer-title"
    >
      <div className="p-3 d-flex justify-content-between align-items-start border-bottom">
        <h2 id="item-drawer-title" className="h5 mb-0">
          {item.issueKey}
        </h2>
        <button
          type="button"
          ref={closeButtonRef}
          className="btn btn-sm btn-outline-secondary"
          onClick={onClose}
          aria-label="Close item details"
        >
          ✕
        </button>
      </div>

      <div className="p-3">
        <div className="mb-3">
          <label htmlFor="item-title" className="form-label">
            Title
          </label>
          <input
            id="item-title"
            className="form-control"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div className="mb-3">
          <label htmlFor="item-description" className="form-label">
            Description
          </label>
          {/* Plain textarea, plain-text value - React escapes it on
              render, and this value is only ever shown via text
              content, never dangerouslySetInnerHTML, so no
              user-authored content is ever interpreted as HTML. */}
          <textarea
            id="item-description"
            className="form-control"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="row g-2 mb-3">
          <div className="col-6">
            <label htmlFor="item-type" className="form-label">
              Type
            </label>
            <select id="item-type" className="form-select" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="TASK">TASK</option>
              <option value="BUG">BUG</option>
              <option value="STORY">STORY</option>
            </select>
          </div>
          <div className="col-6">
            <label htmlFor="item-priority" className="form-label">
              Priority
            </label>
            <select
              id="item-priority"
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
        </div>

        <div className="mb-3">
          <label htmlFor="item-assignee" className="form-label">
            Assignee
          </label>
          <select
            id="item-assignee"
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
          <div className="form-text">Only the project&rsquo;s owning team&rsquo;s members can be assigned.</div>
        </div>

        <div className="mb-3">
          <span className="form-label d-block">Reporter</span>
          <p className="mb-0">{userName(item.reporterId)}</p>
          <div className="form-text">Not editable - set once at creation.</div>
        </div>

        <div className="mb-3">
          <label htmlFor="item-labels" className="form-label">
            Labels
          </label>
          <input
            id="item-labels"
            className="form-control"
            value={labelsText}
            onChange={(e) => setLabelsText(e.target.value)}
            placeholder="comma, separated, labels"
          />
        </div>

        <div className="mb-3">
          <label htmlFor="item-due-date" className="form-label">
            Due date
          </label>
          <input
            id="item-due-date"
            type="date"
            className="form-control"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </div>

        <p className="text-muted small">Version {item.version}</p>

        {saveError && (
          <div className="alert alert-danger" role="alert">
            {saveError}
          </div>
        )}

        <div className="d-flex gap-2">
          <button type="button" className="btn btn-primary" onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="btn btn-outline-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
