import type { BoardColumn, WorkItem } from '../../api/types'

const PRIORITY_BADGE: Record<string, string> = {
  LOW: 'text-bg-secondary',
  MEDIUM: 'text-bg-info',
  HIGH: 'text-bg-warning',
  URGENT: 'text-bg-danger',
}

export function Card({
  item,
  columns,
  pending,
  onOpen,
  onDragStart,
  onDragEnd,
  onMoveToColumn,
  onReorder,
  canMoveUp,
  canMoveDown,
}: {
  item: WorkItem
  columns: BoardColumn[]
  pending: boolean
  onOpen: () => void
  onDragStart: () => void
  onDragEnd: () => void
  onMoveToColumn: (columnId: string) => void
  onReorder: (direction: 'up' | 'down') => void
  canMoveUp: boolean
  canMoveDown: boolean
}): React.ReactElement {
  return (
    <div
      className={`board-card${pending ? ' pending' : ''}`}
      draggable={!pending}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', item.id)
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      data-item-id={item.id}
      data-testid={`card-${item.id}`}
    >
      <button
        type="button"
        className="btn btn-link p-0 text-start board-card-title d-block w-100"
        onClick={onOpen}
        disabled={pending}
      >
        <strong>{item.issueKey}</strong> {item.title}
      </button>
      <div className="board-card-meta">
        <span className={`badge ${PRIORITY_BADGE[item.priority] ?? 'text-bg-secondary'}`}>
          {item.priority}
        </span>
        <span className="badge text-bg-light text-dark border">{item.type}</span>
        {item.labels.map((label) => (
          <span key={label} className="badge text-bg-light text-dark border">
            {label}
          </span>
        ))}
        {item.dueDate && new Date(item.dueDate).getTime() < Date.now() && (
          <span className="badge text-bg-danger">Overdue</span>
        )}
      </div>

      <div className="d-flex gap-1 mt-2 align-items-center">
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary"
          aria-label={`Move ${item.issueKey} up within its column`}
          disabled={pending || !canMoveUp}
          onClick={() => onReorder('up')}
        >
          ↑
        </button>
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary"
          aria-label={`Move ${item.issueKey} down within its column`}
          disabled={pending || !canMoveDown}
          onClick={() => onReorder('down')}
        >
          ↓
        </button>
        <label className="visually-hidden" htmlFor={`move-select-${item.id}`}>
          Move {item.issueKey} to column
        </label>
        <select
          id={`move-select-${item.id}`}
          className="form-select form-select-sm"
          value=""
          disabled={pending}
          onChange={(e) => {
            if (e.target.value) onMoveToColumn(e.target.value)
            e.target.value = ''
          }}
        >
          <option value="">Move to…</option>
          {columns
            .filter((c) => c.id !== item.columnId)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
      </div>
    </div>
  )
}
