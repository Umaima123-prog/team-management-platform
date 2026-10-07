import type { ListItemsFilters } from '../../api/endpoints'
import type { Membership, User, WorkItemPriority, WorkItemType } from '../../api/types'

const PRIORITIES: WorkItemPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT']
const TYPES: WorkItemType[] = ['TASK', 'BUG', 'STORY']

export function BoardFilters({
  filters,
  onChange,
  teamMembers,
  users,
}: {
  filters: ListItemsFilters
  onChange: (next: ListItemsFilters) => void
  teamMembers: Membership[]
  users: User[]
}): React.ReactElement {
  function userName(userId: string): string {
    return users.find((u) => u.id === userId)?.name ?? userId
  }

  return (
    <form className="row g-2 mb-3 align-items-end" aria-label="Board filters" role="search">
      <div className="col-sm-2">
        <label htmlFor="filter-assignee" className="form-label">
          Assignee
        </label>
        <select
          id="filter-assignee"
          className="form-select form-select-sm"
          value={filters.assigneeId ?? ''}
          onChange={(e) => onChange({ ...filters, assigneeId: e.target.value || undefined })}
        >
          <option value="">Anyone</option>
          {teamMembers.map((m) => (
            <option key={m.userId} value={m.userId}>
              {userName(m.userId)}
            </option>
          ))}
        </select>
      </div>
      <div className="col-sm-2">
        <label htmlFor="filter-priority" className="form-label">
          Priority
        </label>
        <select
          id="filter-priority"
          className="form-select form-select-sm"
          value={filters.priority ?? ''}
          onChange={(e) => onChange({ ...filters, priority: e.target.value || undefined })}
        >
          <option value="">Any</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
      <div className="col-sm-2">
        <label htmlFor="filter-type" className="form-label">
          Type
        </label>
        <select
          id="filter-type"
          className="form-select form-select-sm"
          value={filters.type ?? ''}
          onChange={(e) => onChange({ ...filters, type: e.target.value || undefined })}
        >
          <option value="">Any</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <div className="col-sm-2">
        <label htmlFor="filter-label" className="form-label">
          Label
        </label>
        <input
          id="filter-label"
          className="form-control form-control-sm"
          value={filters.label ?? ''}
          onChange={(e) => onChange({ ...filters, label: e.target.value || undefined })}
        />
      </div>
      <div className="col-sm-3">
        <label htmlFor="filter-q" className="form-label">
          Search
        </label>
        <input
          id="filter-q"
          type="search"
          className="form-control form-control-sm"
          placeholder="Title or description"
          value={filters.q ?? ''}
          onChange={(e) => onChange({ ...filters, q: e.target.value || undefined })}
        />
      </div>
      <div className="col-sm-1">
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary w-100"
          onClick={() => onChange({})}
        >
          Clear
        </button>
      </div>
    </form>
  )
}
