import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../../api/client'
import { getBoard, listWorkItems, moveWorkItem, type ListItemsFilters } from '../../api/endpoints'
import type { Board, WorkItem } from '../../api/types'
import { useToast } from '../../context/ToastContext'

export interface MoveRequest {
  itemId: string
  targetColumnId: string
  /** The item to position this one directly before, within the
   * target column - null to place it last. */
  beforeItemId: string | null
}

interface UseBoardItemsResult {
  board: Board | null
  items: WorkItem[]
  loading: boolean
  error: unknown
  reload: () => void
  pendingItemIds: Set<string>
  moveItem: (request: MoveRequest) => Promise<void>
}

/**
 * Owns the board's columns + items and the one operation that
 * mutates their arrangement: `moveItem`. Card movement NEVER becomes
 * a frontend-only state change - every move is:
 *
 * 1. Applied optimistically to local state (so drag/drop feels
 *    immediate) and the moved item is marked "pending".
 * 2. Sent to the real NestJS API with `expectedVersion` (the
 *    item's own currently-known version - see docs/API.md
 *    "Optimistic concurrency").
 * 3. On success: the server's own returned item (new version, real
 *    column/rank) replaces the optimistic guess.
 * 4. On any other failure: the optimistic change is rolled back to
 *    the pre-move snapshot.
 * 5. On a 409 specifically: the ENTIRE board+items are refetched from
 *    the server (local state is no longer trustworthy - something
 *    else changed concurrently) and a clear, specific toast is shown.
 */
export function useBoardItems(
  projectId: string,
  filters: ListItemsFilters,
): UseBoardItemsResult {
  const [board, setBoard] = useState<Board | null>(null)
  const [items, setItems] = useState<WorkItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [pendingItemIds, setPendingItemIds] = useState<Set<string>>(new Set())
  const { showToast } = useToast()

  const reload = useCallback(() => setReloadToken((t) => t + 1), [])

  useEffect(() => {
    if (!projectId) return
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    Promise.all([
      getBoard({ signal: controller.signal }, projectId),
      listWorkItems({ signal: controller.signal }, projectId, filters),
    ])
      .then(([boardResult, itemsPage]) => {
        if (controller.signal.aborted) return
        setBoard(boardResult)
        setItems(itemsPage.items)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setError(err)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filters is a plain object; stringified identity isn't worth the churn here
  }, [projectId, reloadToken, JSON.stringify(filters)])

  const moveItem = useCallback(
    async ({ itemId, targetColumnId, beforeItemId }: MoveRequest) => {
      const snapshot = items
      const moving = items.find((i) => i.id === itemId)
      if (!moving) return

      // Optimistic local reorder: remove the item, then reinsert it
      // at the requested position within the target column.
      const without = items.filter((i) => i.id !== itemId)
      const optimistic = { ...moving, columnId: targetColumnId }
      let insertAt = without.length
      if (beforeItemId) {
        const idx = without.findIndex((i) => i.id === beforeItemId)
        if (idx >= 0) insertAt = idx
      } else {
        // Insert after the last item currently in the target column.
        let lastIndexInColumn = -1
        without.forEach((i, idx) => {
          if (i.columnId === targetColumnId) lastIndexInColumn = idx
        })
        insertAt = lastIndexInColumn + 1
      }
      const next = [...without.slice(0, insertAt), optimistic, ...without.slice(insertAt)]
      setItems(next)
      setPendingItemIds((prev) => new Set(prev).add(itemId))

      try {
        const afterItemId = findNeighborAfter(next, itemId, targetColumnId)
        const updated = await moveWorkItem({}, itemId, {
          expectedVersion: moving.version,
          targetColumnId,
          beforeItemId,
          afterItemId,
        })
        setItems((current) => current.map((i) => (i.id === itemId ? updated : i)))
      } catch (err) {
        if (err instanceof ApiError && err.isVersionConflict) {
          showToast(
            'warning',
            'This item changed on the server since the board was loaded - refreshing the board.',
          )
          reload()
        } else {
          setItems(snapshot)
          showToast('danger', err instanceof ApiError ? err.message : 'Could not move the item.')
        }
      } finally {
        setPendingItemIds((prev) => {
          const next = new Set(prev)
          next.delete(itemId)
          return next
        })
      }
    },
    [items, showToast, reload],
  )

  return { board, items, loading, error, reload, pendingItemIds, moveItem }
}

function findNeighborAfter(
  items: WorkItem[],
  movedItemId: string,
  columnId: string,
): string | null {
  const columnItems = items.filter((i) => i.columnId === columnId)
  const idx = columnItems.findIndex((i) => i.id === movedItemId)
  if (idx <= 0) return null
  return columnItems[idx - 1].id
}
