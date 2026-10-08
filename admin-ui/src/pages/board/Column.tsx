import { useState } from 'react'
import type { BoardColumn, WorkItem } from '../../api/types'
import { Card } from './Card'

export function Column({
  column,
  items,
  allColumns,
  pendingItemIds,
  canMoveItem,
  onOpenItem,
  onMove,
}: {
  column: BoardColumn
  items: WorkItem[]
  allColumns: BoardColumn[]
  pendingItemIds: Set<string>
  canMoveItem: (item: WorkItem) => boolean
  onOpenItem: (item: WorkItem) => void
  onMove: (itemId: string, targetColumnId: string, beforeItemId: string | null) => void
}): React.ReactElement {
  const [dragOver, setDragOver] = useState(false)
  const overWip = column.wipLimit != null && items.length > column.wipLimit

  function handleDrop(event: React.DragEvent, beforeItemId: string | null): void {
    event.preventDefault()
    setDragOver(false)
    const itemId = event.dataTransfer.getData('text/plain')
    if (!itemId) return
    onMove(itemId, column.id, beforeItemId)
  }

  return (
    <section
      className={`board-column${dragOver ? ' drag-over' : ''}`}
      aria-label={`${column.name} column`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => handleDrop(e, null)}
      data-testid={`column-${column.id}`}
    >
      <div className="board-column-header">
        <span>{column.name}</span>
        <span className="d-flex align-items-center gap-2">
          <span className="badge text-bg-secondary">
            {items.length}
            {column.wipLimit != null ? `/${column.wipLimit}` : ''}
          </span>
          {overWip && (
            <span className="badge text-bg-danger" title="Over the configured WIP limit">
              WIP ⚠
            </span>
          )}
        </span>
      </div>
      <div className="board-column-body">
        {items.map((item, index) => (
          <div
            key={item.id}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDrop={(e) => {
              e.stopPropagation()
              handleDrop(e, item.id)
            }}
          >
            <Card
              item={item}
              columns={allColumns}
              pending={pendingItemIds.has(item.id)}
              canMove={canMoveItem(item)}
              onOpen={() => onOpenItem(item)}
              onDragStart={() => setDragOver(false)}
              onDragEnd={() => setDragOver(false)}
              onMoveToColumn={(targetColumnId) => onMove(item.id, targetColumnId, null)}
              onReorder={(direction) => {
                const targetIndex = direction === 'up' ? index - 1 : index + 1
                if (targetIndex < 0 || targetIndex >= items.length) return
                // Moving down past the next item means the item should
                // land AFTER it - i.e. before whatever comes after that.
                const beforeItemId =
                  direction === 'up' ? items[targetIndex].id : items[targetIndex + 1]?.id ?? null
                onMove(item.id, column.id, beforeItemId)
              }}
              canMoveUp={index > 0}
              canMoveDown={index < items.length - 1}
            />
          </div>
        ))}
        {items.length === 0 && <p className="text-muted small text-center mb-0">No items</p>}
      </div>
    </section>
  )
}
